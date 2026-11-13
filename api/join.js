'use strict';
const crypto = require('crypto');
const { redis, pipeline, send, body, normPhone, normName, classes, aidOf, cfg, hashPw, checkPw, ip, limited } = require('./_lib');
const MAX_CLASS = 250;
/* a new student: name + class + phone number + a password he chooses (phone + password = his login on any device) */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), name = normName(b.name), phone = normPhone(b.phone), cls = String(b.cls || '').trim(), pass = String(b.pass || '');
  if (name.length < 2) return send(res, 400, { error: 'bad_name' });
  if (!phone) return send(res, 400, { error: 'bad_phone' });
  if (pass.length < 4 || pass.length > 40) return send(res, 400, { error: 'bad_pass' });
  try {
    if (await limited('mf:fail:j:' + ip(req), 40)) return send(res, 429, { error: 'slow_down' });
    if (!(await classes()).includes(cls)) return send(res, 400, { error: 'bad_class' });
    const aid = aidOf(phone, name), [have, pw] = await redis(['HMGET', 'mf:acc:' + aid, 'cls', 'pw']);
    if (have) {   // the same name on the same number: allowed only with the right password (or an old account that has none yet)
      if (pw && !checkPw(pass, pw)) return send(res, 409, { error: 'name_taken' });
      return send(res, 200, { ok: true, exists: true, aid, name, cls: have, phone });
    }
    if (!(await cfg()).reg) return send(res, 403, { error: 'reg_closed' });
    if ((await redis(['HLEN', 'mf:cls:' + cls])) >= MAX_CLASS) return send(res, 429, { error: 'class_full' });
    const sk = crypto.randomBytes(16).toString('hex'), now = Date.now();
    await pipeline([
      ['HSET', 'mf:acc:' + aid, 'name', name, 'phone', phone, 'cls', cls, 'pw', hashPw(pass), 'sk', sk, 'created', String(now)],
      ['HSET', 'mf:ph:' + phone, aid, JSON.stringify({ n: name, c: cls })],
      ['HSET', 'mf:cls:' + cls, aid, JSON.stringify({ n: name, p: phone, c: '', d: 0 })],
      ['HSET', 'mf:seen:' + cls, aid, JSON.stringify({ t: now })]]);
    return send(res, 200, { ok: true, created: true, aid, name, cls, phone, sk });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
