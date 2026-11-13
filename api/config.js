'use strict';
const { redis, send, deny, body, classes, cfg, cleanCfg, saveCfg, eff } = require('./_lib');
/* GET (public): the class list the students choose from + the game settings.
   POST (teacher token): {classes:[...]} replaces the class list; {cfg:{...}} changes the game settings. */
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      if (await deny(req, res)) return;
      const b = await body(req); let out = {};
      if (Array.isArray(b.classes)) {
        const a = b.classes.map(x => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 24)).filter(x => x.length >= 2);
        const u = [...new Set(a)].slice(0, 16); if (!u.length) return send(res, 400, { error: 'bad_class' });
        await redis(['SET', 'mf:classes', JSON.stringify(u)]); out.classes = u;
      }
      if (b.cfg && typeof b.cfg === 'object') out.cfg = await saveCfg(cleanCfg(b.cfg, await cfg(true)));
      return send(res, 200, Object.assign({ ok: true }, out));
    }
    return send(res, 200, { ok: true, classes: await classes(), cfg: eff(await cfg(), null) });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
