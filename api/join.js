'use strict';
const { redis, pipeline, send, body, normPhone, normName, classes, aidOf, cfg } = require('./_lib');
const MAX_CLASS = 250;
/* a new student: name + class + phone number (the phone number is the login code on any device) */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), name = normName(b.name), phone = normPhone(b.phone), cls = String(b.cls || '').trim();
  if (name.length < 2) return send(res, 400, { error: 'bad_name' });
  if (!phone) return send(res, 400, { error: 'bad_phone' });
  try {
    if (!(await classes()).includes(cls)) return send(res, 400, { error: 'bad_class' });
    const aid = aidOf(phone, name), have = await redis(['HGET', 'mf:acc:' + aid, 'cls']);
    if (have) return send(res, 200, { ok: true, exists: true, aid, name, cls: have, phone });
    if (!(await cfg()).reg) return send(res, 403, { error: 'reg_closed' });
    if ((await redis(['HLEN', 'mf:cls:' + cls])) >= MAX_CLASS) return send(res, 429, { error: 'class_full' });
    const now = Date.now();
    await pipeline([
      ['HSET', 'mf:acc:' + aid, 'name', name, 'cls', cls, 'phone', phone, 'jt', String(now)],
      ['HSET', 'mf:ph:' + phone, aid, JSON.stringify({ n: name, c: cls })],
      ['HSET', 'mf:cls:' + cls, aid, JSON.stringify({ n: name, p: phone, c: '', d: 0 })],
      ['HSET', 'mf:seen:' + cls, aid, JSON.stringify({ t: now })]]);
    return send(res, 200, { ok: true, created: true, aid, name, cls, phone });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
