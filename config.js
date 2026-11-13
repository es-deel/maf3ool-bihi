'use strict';
const { redis, send, deny, body, classes } = require('./_lib');
/* GET: the class list the students choose from. POST (teacher key): replace it. */
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      if (deny(req, res)) return;
      const b = await body(req); const a = (Array.isArray(b.classes) ? b.classes : []).map(x => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 24)).filter(x => x.length >= 2);
      const u = [...new Set(a)].slice(0, 16); if (!u.length) return send(res, 400, { error: 'bad_class' });
      await redis(['SET', 'mf:classes', JSON.stringify(u)]); return send(res, 200, { ok: true, classes: u });
    }
    return send(res, 200, { ok: true, classes: await classes() });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
