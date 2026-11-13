'use strict';
const { redis, send, deny, body, classes, cfg, cleanCfg, saveCfg, eff, qs } = require('./_lib');
/* GET (public): the class list the students choose from + the game settings.  GET ?logo=1: the report logo (kept apart because it is large).
   POST (teacher token): {classes:[...]} replaces the class list; {cfg:{...}} changes the settings; {logo:'data:image/…'|''} sets or removes the report logo. */
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
      let patch = b.cfg && typeof b.cfg === 'object' ? Object.assign({}, b.cfg) : null;
      if (typeof b.logo === 'string') {
        if (b.logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logo)) return send(res, 400, { error: 'bad_logo' });
        if (b.logo.length > 120000) return send(res, 413, { error: 'logo_big' });
        if (b.logo) await redis(['SET', 'mf:logo', b.logo]); else await redis(['DEL', 'mf:logo']);
        patch = Object.assign(patch || {}, { rep: Object.assign({}, patch && patch.rep, { logoV: b.logo ? Date.now() : 0 }) });
      }
      if (patch) out.cfg = await saveCfg(cleanCfg(patch, await cfg(true)));
      return send(res, 200, Object.assign({ ok: true }, out));
    }
    if (qs(req, 'logo')) { res.setHeader('cache-control', 'public, max-age=60'); return send(res, 200, { ok: true, logo: (await redis(['GET', 'mf:logo'])) || '' }); }
    return send(res, 200, { ok: true, classes: await classes(), cfg: eff(await cfg(), null) });
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
