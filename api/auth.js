'use strict';
const { redis, send, body, deny, hashPw, checkPw, userKey, same, newToken, ip, h2o } = require('./_lib');
/* teacher accounts. GET: is an account already set up?  POST ops:
   setup  {user,pass,key}  create (or reset the password of) a teacher account; needs the TEACHER_KEY secret of the server (first set-up / recovery)
   login  {user,pass}      -> token
   logout / me / passwd {old,pass} / add {user,pass} / remove {user} / list : need the token */
const okPass = p => typeof p === 'string' && p.length >= 6 && p.length <= 60;
const okUser = u => u.length >= 3;
module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') return send(res, 200, { ok: true, setup: (await redis(['HLEN', 'mf:teach'])) > 0 });
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    const b = await body(req), op = String(b.op || '');
    if (op === 'setup') {
      const want = process.env.TEACHER_KEY; if (!want) return send(res, 503, { error: 'no_teacher_key' });
      const f = 'mf:fail:setup:' + ip(req), n = await redis(['INCR', f]); await redis(['EXPIRE', f, '600']); if (n > 8) return send(res, 429, { error: 'slow_down' });
      if (!same(b.key || '', want)) return send(res, 401, { error: 'bad_key' });
      const u = userKey(b.user); if (!okUser(u)) return send(res, 400, { error: 'bad_user' }); if (!okPass(b.pass)) return send(res, 400, { error: 'bad_pass' });
      await redis(['HSET', 'mf:teach', u, hashPw(b.pass)]); await redis(['DEL', f]);
      return send(res, 200, { ok: true, user: u, tok: await newToken(u) });
    }
    if (op === 'login') {
      const u = userKey(b.user), f1 = 'mf:fail:u:' + u, f2 = 'mf:fail:i:' + ip(req);
      const [a, c] = [Number(await redis(['GET', f1])) || 0, Number(await redis(['GET', f2])) || 0];
      if (a >= 8 || c >= 30) return send(res, 429, { error: 'slow_down' });
      const st = u ? await redis(['HGET', 'mf:teach', u]) : null;
      if (!st || !checkPw(b.pass || '', st)) { await redis(['INCR', f1]); await redis(['EXPIRE', f1, '600']); await redis(['INCR', f2]); await redis(['EXPIRE', f2, '600']); return send(res, 401, { error: 'bad_login' }); }
      await redis(['DEL', f1]);
      return send(res, 200, { ok: true, user: u, tok: await newToken(u) });
    }
    if (await deny(req, res)) return;
    const me = req.teacher;
    if (op === 'me') return send(res, 200, { ok: true, user: me });
    if (op === 'logout') { await redis(['DEL', 'mf:tok:' + String(req.headers['x-tok'])]); return send(res, 200, { ok: true }); }
    if (op === 'passwd') {
      if (!okPass(b.pass)) return send(res, 400, { error: 'bad_pass' });
      if (!checkPw(b.old || '', await redis(['HGET', 'mf:teach', me]))) return send(res, 401, { error: 'bad_login' });
      await redis(['HSET', 'mf:teach', me, hashPw(b.pass)]); return send(res, 200, { ok: true });
    }
    if (op === 'add') {
      const u = userKey(b.user); if (!okUser(u)) return send(res, 400, { error: 'bad_user' }); if (!okPass(b.pass)) return send(res, 400, { error: 'bad_pass' });
      if (await redis(['HEXISTS', 'mf:teach', u])) return send(res, 409, { error: 'exists' });
      await redis(['HSET', 'mf:teach', u, hashPw(b.pass)]); return send(res, 200, { ok: true });
    }
    if (op === 'list') return send(res, 200, { ok: true, users: await redis(['HKEYS', 'mf:teach']), me });
    if (op === 'remove') {
      const u = userKey(b.user); if (u === me) return send(res, 400, { error: 'self' });
      await redis(['HDEL', 'mf:teach', u]); return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: 'bad_op' });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
