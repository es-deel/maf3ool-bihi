'use strict';
const { redis, pipeline, send, deny, body, classes } = require('./_lib');
/* teacher tools: delete a student, or move him to another class */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (deny(req, res)) return;
  const b = await body(req), aid = String(b.aid || '').slice(0, 200);
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
    return send(res, 400, { error: 'bad_op' });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
