'use strict';
const crypto = require('crypto');
const { redis, pipeline, send, body, normPhone, h2o, checkPw, hashPw, ip, limited } = require('./_lib');
/* sign in with phone number + password: returns the saved progress. Children may share one phone (each has his own password); if several
   accounts match, the student picks his name. An account created before passwords existed takes the first password typed (it is "claimed"). */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), phone = normPhone(b.phone), pass = String(b.pass || '');
  if (!phone) return send(res, 400, { error: 'bad_phone' });
  if (pass.length < 4 || pass.length > 40) return send(res, 400, { error: 'bad_pass' });
  try {
    if ((await limited('mf:fail:l:' + phone, 12)) || (await limited('mf:fail:li:' + ip(req), 60))) return send(res, 429, { error: 'slow_down' });
    const list = h2o(await redis(['HGETALL', 'mf:ph:' + phone])), ids = Object.keys(list);
    if (!ids.length) return send(res, 401, { error: 'bad_login' });
    const pws = await pipeline(ids.map(a => ['HGET', 'mf:acc:' + a, 'pw']));
    const ok = ids.filter((a, i) => !pws[i] || checkPw(pass, pws[i]));
    if (!ok.length) return send(res, 401, { error: 'bad_login' });
    let aid = b.aid && ok.includes(b.aid) ? b.aid : ok.length === 1 ? ok[0] : null;
    if (!aid) return send(res, 200, { ok: true, choose: ok.map(k => { let o = {}; try { o = JSON.parse(list[k]); } catch (e) { } return { aid: k, n: o.n, c: o.c }; }) });
    let [name, cls, snap, ts, sk, pw, rv, rst, ce] = await redis(['HMGET', 'mf:acc:' + aid, 'name', 'cls', 'snap', 'ts', 'sk', 'pw', 'rv', 'rst', 'ce']);
    if (!name) return send(res, 401, { error: 'bad_login' });
    const set = []; if (!sk) { sk = crypto.randomBytes(16).toString('hex'); set.push('sk', sk); } if (!pw) set.push('pw', hashPw(pass));
    const cmds = [['HSET', 'mf:seen:' + cls, aid, JSON.stringify({ t: Date.now() })]]; if (set.length) cmds.push(['HSET', 'mf:acc:' + aid].concat(set));
    await pipeline(cmds);
    return send(res, 200, { ok: true, aid, name, cls, phone, sk, snap: snap || '', ts: +ts || 0, rv: +rv || 0, ce: ce === '1' ? 1 : 0, rst: rst ? (() => { try { return JSON.parse(rst); } catch (e) { return null; } })() : null });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
