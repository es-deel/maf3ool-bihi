'use strict';
const crypto = require('crypto');
const { redis, pipeline, send, deny, body, classes, h2o, hashPw, cfg, normPhone, normName, aidOf } = require('./_lib');
const err = e => ({ code: e.code === 'no_db' ? 503 : 500, o: { error: e.code === 'no_db' ? 'no_db' : 'server' } });

/* delete one student and everything stored about him */
async function delOne(aid) {
  const [name, cls, phone, vt] = await redis(['HMGET', 'mf:acc:' + aid, 'name', 'cls', 'phone', 'vt']);
  if (!name) return false;
  const c = [['DEL', 'mf:acc:' + aid], ['HDEL', 'mf:ph:' + phone, aid], ['HDEL', 'mf:cls:' + cls, aid], ['HDEL', 'mf:seen:' + cls, aid]]; if (vt) c.push(['DEL', 'mf:vt:' + vt]);
  await pipeline(c); return true;
}
/* move one student to another class */
async function moveOne(aid, to) {
  const [name, cls, phone] = await redis(['HMGET', 'mf:acc:' + aid, 'name', 'cls', 'phone']); if (!name) return false; if (cls === to) return true;
  const row = await redis(['HGET', 'mf:cls:' + cls, aid]);
  await pipeline([['HSET', 'mf:acc:' + aid, 'cls', to], ['HDEL', 'mf:cls:' + cls, aid], ['HDEL', 'mf:seen:' + cls, aid], ['HSET', 'mf:cls:' + to, aid, row || JSON.stringify({ n: name, p: phone, c: '', d: 0 })],
    ['HSET', 'mf:ph:' + phone, aid, JSON.stringify({ n: name, c: to })], ['HSET', 'mf:seen:' + to, aid, JSON.stringify({ t: Date.now() })]]);
  return true;
}
/* edit name / phone / class. The account id is phone~name, so a new name or phone moves the whole account to a new id. */
async function editOne(aid, b, list) {
  const all = h2o(await redis(['HGETALL', 'mf:acc:' + aid])); if (!all.name) return { error: 'no_account', code: 404 };
  const name = b.name != null ? normName(b.name) : all.name, phone = b.phone != null && String(b.phone).trim() ? normPhone(b.phone) : all.phone, cls = b.cls || all.cls;
  if (name.length < 2) return { error: 'bad_name', code: 400 }; if (!phone) return { error: 'bad_phone', code: 400 }; if (!list.includes(cls)) return { error: 'bad_class', code: 400 };
  const nid = aidOf(phone, name);
  if (nid !== aid && (await redis(['HEXISTS', 'mf:acc:' + nid, 'name']))) return { error: 'exists', code: 409 };
  if (nid === aid && name === all.name && phone === all.phone && cls === all.cls) return { ok: true, aid };
  const row = await redis(['HGET', 'mf:cls:' + all.cls, aid]), seen = await redis(['HGET', 'mf:seen:' + all.cls, aid]);
  let r = {}; try { r = JSON.parse(row || '{}'); } catch (e) { } r.n = name; r.p = phone;
  const acc = Object.assign({}, all, { name, phone, cls }), flat = []; Object.keys(acc).forEach(k => flat.push(k, acc[k]));
  const c = [];
  if (nid !== aid) c.push(['DEL', 'mf:acc:' + aid]);
  c.push(['HSET', 'mf:acc:' + nid].concat(flat), ['HDEL', 'mf:ph:' + all.phone, aid], ['HSET', 'mf:ph:' + phone, nid, JSON.stringify({ n: name, c: cls })],
    ['HDEL', 'mf:cls:' + all.cls, aid], ['HDEL', 'mf:seen:' + all.cls, aid], ['HSET', 'mf:cls:' + cls, nid, JSON.stringify(r)]);
  if (seen) c.push(['HSET', 'mf:seen:' + cls, nid, seen]);
  if (all.vt) c.push(['SET', 'mf:vt:' + all.vt, nid]);
  await pipeline(c); return { ok: true, aid: nid };
}
/* rename a class: every student moves with it, and the class list is updated */
async function rename(b, res) {
  try {
    const from = String(b.from || '').trim(), to = String(b.to || '').replace(/\s+/g, ' ').trim().slice(0, 24), list = await classes();
    if (!list.includes(from)) return send(res, 400, { error: 'bad_class' }); if (to.length < 2 || list.includes(to)) return send(res, 400, { error: 'bad_class' });
    const rows = h2o((await redis(['HGETALL', 'mf:cls:' + from])) || []), seen = h2o((await redis(['HGETALL', 'mf:seen:' + from])) || []), ids = Object.keys(rows), cmds = [];
    for (const aid of ids) {
      cmds.push(['HSET', 'mf:cls:' + to, aid, rows[aid]], ['HSET', 'mf:acc:' + aid, 'cls', to]);
      if (seen[aid]) cmds.push(['HSET', 'mf:seen:' + to, aid, seen[aid]]);
      try { const r = JSON.parse(rows[aid]); if (r.p) cmds.push(['HSET', 'mf:ph:' + r.p, aid, JSON.stringify({ n: r.n, c: to })]); } catch (e) { }
    }
    for (let i = 0; i < cmds.length; i += 200) await pipeline(cmds.slice(i, i + 200));
    await pipeline([['DEL', 'mf:cls:' + from], ['DEL', 'mf:seen:' + from], ['SET', 'mf:classes', JSON.stringify(list.map(c => c === from ? to : c))]]);
    return send(res, 200, { ok: true, moved: ids.length });
  } catch (e) { const x = err(e); return send(res, x.code, x.o); }
}
/* teacher tools: manage students (edit, move, delete, password, report link, bulk) and classes */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (await deny(req, res)) return;
  const b = await body(req), aid = String(b.aid || '').slice(0, 200), op = b.op;
  try {
    if (op === 'rename') return rename(b, res);
    if (op === 'addclass' || op === 'delclass') {
      const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 24), list = await classes();
      if (op === 'addclass') { if (name.length < 2 || list.includes(name) || list.length >= 16) return send(res, 400, { error: 'bad_class' }); list.push(name); }
      else { if (!list.includes(name) || list.length < 2) return send(res, 400, { error: 'bad_class' }); if ((await redis(['HLEN', 'mf:cls:' + name])) > 0) return send(res, 409, { error: 'has_students' }); list.splice(list.indexOf(name), 1); }
      await redis(['SET', 'mf:classes', JSON.stringify(list)]); return send(res, 200, { ok: true, classes: list });
    }
    if (op === 'bulk') {   // many students at once: {act:'del'|'move', aids:[…], to}
      const aids = (Array.isArray(b.aids) ? b.aids : []).map(x => String(x).slice(0, 200)).slice(0, 120); let n = 0;
      if (b.act === 'move') { const to = String(b.to || '').trim(); if (!(await classes()).includes(to)) return send(res, 400, { error: 'bad_class' }); for (const a of aids) if (await moveOne(a, to)) n++; }
      else if (b.act === 'del') { for (const a of aids) if (await delOne(a)) n++; }
      else return send(res, 400, { error: 'bad_op' });
      return send(res, 200, { ok: true, n });
    }
    if (op === 'edit') { const r = await editOne(aid, b, await classes()); return send(res, r.code || 200, r.code ? { error: r.error } : r); }
    if (op === 'del') return (await delOne(aid)) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'no_account' });
    if (op === 'move') { const to = String(b.to || '').trim(); if (!(await classes()).includes(to)) return send(res, 400, { error: 'bad_class' }); return (await moveOne(aid, to)) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'no_account' }); }
    if (op === 'setpw') {   // forgotten password: the teacher sets a new one (old devices must sign in again)
      const pass = String(b.pass || ''); if (pass.length < 4 || pass.length > 40) return send(res, 400, { error: 'bad_pass' });
      if (!(await redis(['HEXISTS', 'mf:acc:' + aid, 'name']))) return send(res, 404, { error: 'no_account' });
      await redis(['HSET', 'mf:acc:' + aid, 'pw', hashPw(pass), 'sk', crypto.randomBytes(16).toString('hex')]); return send(res, 200, { ok: true });
    }
    if (op === 'share') {   // a private link to the student's report, for the parent (the teacher sends it on WhatsApp)
      if (!(await redis(['HEXISTS', 'mf:acc:' + aid, 'name']))) return send(res, 404, { error: 'no_account' });
      let vt = await redis(['HGET', 'mf:acc:' + aid, 'vt']);
      if (!vt || b.renew) { if (vt) await redis(['DEL', 'mf:vt:' + vt]); vt = crypto.randomBytes(12).toString('hex'); await pipeline([['HSET', 'mf:acc:' + aid, 'vt', vt], ['SET', 'mf:vt:' + vt, aid]]); }
      return send(res, 200, { ok: true, vt });
    }
    if (op === 'award' || op === 'unaward') {   // a title / medal the teacher gives to one or several students: {aids:[…]|aid, t, ic, n} or {aid, id}
      const list = op === 'award' ? (Array.isArray(b.aids) ? b.aids : [aid]).map(x => String(x || '').slice(0, 200)).filter(Boolean).slice(0, 120) : [aid];
      const t = String(b.t || '').replace(/\s+/g, ' ').trim().slice(0, 40), ic = String(b.ic || 'trophy').replace(/[^a-z_]/g, '').slice(0, 40) || 'trophy', n = String(b.n || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      if (op === 'award' && t.length < 2) return send(res, 400, { error: 'bad_title' });
      let k = 0;
      for (const a of list) {
        const cur = await redis(['HGET', 'mf:acc:' + a, 'aw']); if (cur === null && !(await redis(['HEXISTS', 'mf:acc:' + a, 'name']))) continue;
        let aw = []; try { aw = JSON.parse(cur || '[]'); } catch (e) { aw = []; }
        if (op === 'award') { aw.unshift({ id: crypto.randomBytes(4).toString('hex'), t, ic, n, at: Date.now() }); aw = aw.slice(0, 30); }
        else aw = aw.filter(x => x.id !== String(b.id || ''));
        await redis(['HSET', 'mf:acc:' + a, 'aw', JSON.stringify(aw)]); k++;
      }
      return send(res, 200, { ok: true, n: k });
    }
    if (op === 'reset') {   // the teacher resets some parts of one or several students' progress: {aids|aid, scopes:[score|progress|bonus|daily|badges|stats]}
      const RS = { score: ['led', 'pb', 'dq', 'ps', 'gb', 'fb'], progress: ['done', 'seen', 'sd', 'pos', 'lit', 'pu'], bonus: ['bn', 'cmb'], daily: ['dc', 'wk', 'wkh'], badges: ['bdg', 'gift', 'rk'], stats: ['st'] };
      const scopes = (Array.isArray(b.scopes) ? b.scopes : []).filter(x => RS[x]).filter((x, i, a) => a.indexOf(x) === i);
      if (!scopes.length) return send(res, 400, { error: 'bad' });
      const list = (Array.isArray(b.aids) ? b.aids : [aid]).map(x => String(x || '').slice(0, 200)).filter(Boolean).slice(0, 250), keys = [].concat(...scopes.map(x => RS[x]));
      const id = Date.now().toString(36); let k = 0;
      for (const a of list) {
        const [name, cls, snap, rv, phone] = await redis(['HMGET', 'mf:acc:' + a, 'name', 'cls', 'snap', 'rv', 'phone']); if (!name) continue;
        let s0 = null; try { s0 = snap ? JSON.parse(snap) : null; } catch (e) { s0 = null; }
        const set = ['rst', JSON.stringify({ id, scopes, at: Date.now() }), 'rv', String((+rv || 0) + 1)];
        if (s0 && s0.d) { keys.forEach(x => { delete s0.d[x]; }); s0.ts = Date.now(); set.push('snap', JSON.stringify(s0), 'ts', String(s0.ts), 'bk', snap, 'bkt', String(Date.now())); }
        const cmds = [['HSET', 'mf:acc:' + a].concat(set)];
        if (scopes.includes('score')) { cmds[0].push('code', '', 'det', ''); cmds.push(['HSET', 'mf:cls:' + cls, a, JSON.stringify({ n: name, p: phone, c: '', d: 0 })]); }
        await pipeline(cmds); k++;
      }
      return send(res, 200, { ok: true, n: k });
    }
    if (op === 'certok' || op === 'certno') {   // let some students have the certificate whatever the conditions: {aids|aid, v:true|false}
      const list = (Array.isArray(b.aids) ? b.aids : [aid]).map(x => String(x || '').slice(0, 200)).filter(Boolean).slice(0, 250); let k = 0;
      for (const a of list) { if (!(await redis(['HGET', 'mf:acc:' + a, 'name']))) continue; await redis(['HSET', 'mf:acc:' + a, 'ce', b.v === false || op === 'certno' ? '' : '1']); k++; }
      return send(res, 200, { ok: true, n: k });
    }
    if (op === 'wkstat') {   // progress of the weekly class goal: total, participants, top contributors
      const c = await cfg(true), w = c.wk;
      if (!w || !w.id) return send(res, 200, { ok: true, wk: null });
      const flat = await redis(['HGETALL', 'mf:wk:' + w.id]), tot = +(await redis(['GET', 'mf:wk:' + w.id + ':t'])) || 0, rows = [];
      const m = {}; if (Array.isArray(flat)) { for (let i = 0; i + 1 < flat.length; i += 2) m[flat[i]] = +flat[i + 1] || 0; } else if (flat && typeof flat === 'object') Object.keys(flat).forEach(k => { m[k] = +flat[k] || 0; });
      const top = Object.keys(m).sort((a, b) => m[b] - m[a]).slice(0, 10);
      const info = top.length ? await pipeline(top.map(a => ['HMGET', 'mf:acc:' + a, 'name', 'cls'])) : [];
      top.forEach((a, i) => rows.push({ n: (info[i] && info[i][0]) || '—', c: (info[i] && info[i][1]) || '', v: m[a] }));
      return send(res, 200, { ok: true, wk: { id: w.id, t: w.t, goal: w.goal, end: w.end, cls: w.cls || [], from: w.from || 0 }, tot, parts: Object.keys(m).length, top: rows });
    }
    if (op === 'snapback') {   // bring back the safety copy of the student's progress (the current version becomes the new safety copy)
      const [snap, bk, rv] = await redis(['HMGET', 'mf:acc:' + aid, 'snap', 'bk', 'rv']);
      if (!bk) return send(res, 404, { error: 'no_backup' });
      let ts = 0; try { ts = +JSON.parse(bk).ts || 0; } catch (e) { ts = 0; }
      await redis(['HSET', 'mf:acc:' + aid, 'snap', bk, 'bk', snap || '', 'bkt', String(Date.now()), 'ts', String(Math.max(ts, Date.now())), 'rv', String((+rv || 0) + 1)]);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: 'bad_op' });
  } catch (e) { const x = err(e); return send(res, x.code, x.o); }
};
