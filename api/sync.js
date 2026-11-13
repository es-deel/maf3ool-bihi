'use strict';
const { redis, pipeline, send, body, parseCode, nameKey, cfg, eff, same } = require('./_lib');
const MAX_SNAP = 250000, MAX_DETAIL = 40000;
/* the student's page calls this: a heartbeat (who is writing now), and the progress snapshot + result code + detailed report when something changed */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const b = await body(req), aid = String(b.aid || '').slice(0, 200);
  if (!aid) return send(res, 400, { error: 'bad_account' });
  try {
    const [name, cls, phone, ts0, sk, aw, rv0, snap0, bkt0] = await redis(['HMGET', 'mf:acc:' + aid, 'name', 'cls', 'phone', 'ts', 'sk', 'aw', 'rv', 'snap', 'bkt']);
    if (!name) return send(res, 404, { error: 'no_account' });
    if (!sk || !same(b.sk || '', sk)) return send(res, 401, { error: 'bad_session' });
    const now = Date.now(), w = String(b.w || '').slice(0, 40), cmds = [['HSET', 'mf:seen:' + cls, aid, JSON.stringify({ t: now, w, cv: Math.floor(+b.cv || 0) })]];
    let status = 'ping', set = [], rv = +rv0 || 0, extra = {};
    if (typeof b.snap === 'string' && b.snap.length && b.snap.length <= MAX_SNAP) {
      const ts = Math.floor(+b.ts || 0);
      /* every save carries the revision it was built on (bv): it is accepted only on top of the latest revision, so two devices can never silently overwrite each other (the clock of the device no longer matters).
         An older page without bv falls back to comparing times. A refused save gets the stored snapshot back, and the page merges the two. */
      const hasBv = b.bv !== undefined && b.bv !== null && b.bv !== '';
      const fine = hasBv ? Math.floor(+b.bv) === rv : ts >= (+ts0 || 0);
      if (fine) {
        set.push('snap', b.snap, 'ts', String(ts), 'rv', String(rv + 1)); rv += 1; status = 'saved';
        /* one safety copy of the previous version (at most every 20 minutes, or at once when the new one is much smaller): the teacher can bring it back */
        if (snap0 && snap0 !== b.snap && (Date.now() - (+bkt0 || 0) > 20 * 60000 || b.snap.length < snap0.length * 0.7)) set.push('bk', snap0, 'bkt', String(Date.now()));
      } else { status = 'old'; extra = { snap: snap0 || '', ts: +ts0 || 0 }; }
    }
    if (status !== 'old' && b.code) {
      const x = parseCode(b.code);
      if (x && nameKey(x.name) === nameKey(name)) {
        let det = '';
        if (b.detail && typeof b.detail === 'object' && !Array.isArray(b.detail)) { try { det = JSON.stringify({ c: b.code, d: b.detail }); } catch (e) { det = ''; } if (det.length > MAX_DETAIL) det = ''; }
        set.push('code', b.code); if (det) set.push('det', det);
        cmds.push(['HSET', 'mf:cls:' + cls, aid, JSON.stringify({ n: name, p: phone, c: b.code, d: det ? 1 : (b.keepDet ? 1 : 0) })]);
        status = status === 'old' ? status : 'saved';
      }
    }
    if (set.length) cmds.push(['HSET', 'mf:acc:' + aid].concat(set));
    await pipeline(cmds);
    let awards = []; try { awards = aw ? JSON.parse(aw) : []; } catch (e) { awards = []; }
    return send(res, 200, Object.assign({ ok: true, status, rv, cfg: eff(await cfg(), cls), aw: awards }, extra));
  } catch (e) { return send(res, e.code === 'no_db' ? 503 : 500, { error: e.code === 'no_db' ? 'no_db' : 'server' }); }
};
