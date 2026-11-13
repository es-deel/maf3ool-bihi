'use strict';
const { redis, pipeline, send, deny, body, classes, h2o } = require('./_lib');
const crypto = require('crypto');
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
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
}

/* teacher tools: delete a student, or move him to another class */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (await deny(req, res)) return;
  const b = await body(req), aid = String(b.aid || '').slice(0, 200);
  if (b.op === 'rename') return rename(b, res);
  if (b.op === 'addclass' || b.op === 'delclass') {
    try {
      const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 24), list = await classes();
      if (b.op === 'addclass') { if (name.length < 2 || list.includes(name) || list.length >= 16) return send(res, 400, { error: 'bad_class' }); list.push(name); }
      else { if (!list.includes(name) || list.length < 2) return send(res, 400, { error: 'bad_class' }); if ((await redis(['HLEN', 'mf:cls:' + name])) > 0) return send(res, 409, { error: 'has_students' }); list.splice(list.indexOf(name), 1); }
      await redis(['SET', 'mf:classes', JSON.stringify(list)]); return send(res, 200, { ok: true, classes: list });
    } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
  }
  try {
    const [name, cls, phone] = await redis(['HMGET', 'mf:acc:' + aid, 'name', 'cls', 'phone']);
    if (!name) return send(res, 404, { error: 'no_account' });
    if (b.op === 'del') {
      await pipeline([['DEL', 'mf:acc:' + aid], ['HDEL', 'mf:ph:' + phone, aid], ['HDEL', 'mf:cls:' + cls, aid], ['HDEL', 'mf:seen:' + cls, aid]]);
      return send(res, 200, { ok: true });
    }
    if (b.op === 'move') {
      const to = String(b.to || '').trim(); if (!(await classes()).includes(to)) return send(res, 400, { error: 'bad_class' });
      const row = await redis(['HGET', 'mf:cls:' + cls, aid]);
      await pipeline([['HSET', 'mf:acc:' + aid, 'cls', to], ['HDEL', 'mf:cls:' + cls, aid], ['HDEL', 'mf:seen:' + cls, aid], ['HSET', 'mf:cls:' + to, aid, row || JSON.stringify({ n: name, p: phone, c: '', d: 0 })],
        ['HSET', 'mf:ph:' + phone, aid, JSON.stringify({ n: name, c: to })], ['HSET', 'mf:seen:' + to, aid, JSON.stringify({ t: Date.now() })]]);
      return send(res, 200, { ok: true });
    }
    if (b.op === 'share') {   // a private link to the student's report, for the parent (the teacher sends it on WhatsApp)
      let vt = await redis(['HGET', 'mf:acc:' + aid, 'vt']);
      if (!vt || b.renew) { if (vt) await redis(['DEL', 'mf:vt:' + vt]); vt = crypto.randomBytes(12).toString('hex'); await pipeline([['HSET', 'mf:acc:' + aid, 'vt', vt], ['SET', 'mf:vt:' + vt, aid]]); }
      return send(res, 200, { ok: true, vt });
    }
    return send(res, 400, { error: 'bad_op' });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
