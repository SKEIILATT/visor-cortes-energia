export function syncHashState(ctx) {
  if (!ctx.state.map || ctx.state.hashSyncBlocked) return;

  const center = ctx.state.map.getCenter();
  const zoom = ctx.state.map.getZoom();

  const hashParams = new URLSearchParams();
  hashParams.set('lat', center.lat.toFixed(6));
  hashParams.set('lng', center.lng.toFixed(6));
  hashParams.set('z', String(zoom));
  hashParams.set('m', String(ctx.state.minute));
  hashParams.set('mode', ctx.state.mode);
  hashParams.set('theme', ctx.state.theme);
  hashParams.set('geom', ctx.state.geomMode);

  const hidden = Array.from(ctx.state.groups.values())
    .filter(function (g) { return !g.visible; })
    .map(function (g) { return encodeURIComponent(g.key); });

  if (hidden.length) hashParams.set('off', hidden.join('~'));

  const base = ctx.state.datasetId ? ('?dataset=' + encodeURIComponent(ctx.state.datasetId)) : '';
  const newUrl = window.location.pathname + base + '#' + hashParams.toString();
  history.replaceState(null, '', newUrl);
}

export function readHashState() {
  const raw = window.location.hash ? window.location.hash.slice(1) : '';
  if (!raw) return null;

  const p = new URLSearchParams(raw);
  const parsed = { view: null, minute: null, mode: null, theme: null, geomMode: null, hiddenGroups: [] };

  const lat = Number(p.get('lat'));
  const lng = Number(p.get('lng'));
  const z = Number(p.get('z'));
  if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(z)) {
    parsed.view = { lat: lat, lng: lng, z: z };
  }

  const m = Number(p.get('m'));
  if (Number.isFinite(m)) parsed.minute = m;

  const mode = p.get('mode');
  if (mode === 'group' || mode === 'outage') parsed.mode = mode;

  const theme = p.get('theme');
  if (theme === 'light' || theme === 'dark') parsed.theme = theme;

  const geom = p.get('geom');
  if (geom === 'detail' || geom === 'fused') parsed.geomMode = geom;

  const off = p.get('off');
  if (off) parsed.hiddenGroups = off.split('~').map(function (v) { return decodeURIComponent(v); });

  return parsed;
}

export function applyPendingHashState(ctx) {
  if (!ctx.state.pendingHashState) return;

  ctx.state.hashSyncBlocked = true;
  const hs = ctx.state.pendingHashState;

  if (hs.mode) ctx._hooks.setMode(ctx, hs.mode);
  if (hs.theme) ctx._hooks.applyTheme(ctx, hs.theme);
  if (hs.geomMode === 'fused' && ctx.state.geomMode !== 'fused') {
    ctx._hooks.toggleGeomMode(ctx);
  }

  if (Array.isArray(hs.hiddenGroups) && hs.hiddenGroups.length) {
    for (let i = 0; i < hs.hiddenGroups.length; i += 1) {
      const g = ctx.state.groups.get(hs.hiddenGroups[i]);
      if (g) g.visible = false;
    }
  }

  if (Number.isFinite(hs.minute) && hs.minute >= 0) {
    ctx._hooks.setMinute(ctx, hs.minute);
  }

  ctx.state.hashSyncBlocked = false;
}
