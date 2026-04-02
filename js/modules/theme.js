export function loadThemePreference() {
  const stored = localStorage.getItem('geo_viewer_theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

export function applyTheme(ctx, theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  ctx.state.theme = next;
  document.body.setAttribute('data-theme', next);
  localStorage.setItem('geo_viewer_theme', next);
  if (ctx.els.btnTheme) {
    ctx.els.btnTheme.textContent = next === 'dark' ? 'Tema claro' : 'Tema oscuro';
  }
}

export function toggleTheme(ctx) {
  applyTheme(ctx, ctx.state.theme === 'dark' ? 'light' : 'dark');
  ctx.els.statusPill.textContent = 'Tema cambiado a ' + (ctx.state.theme === 'dark' ? 'oscuro' : 'claro') + '.';
  ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
  ctx.els.statusPill.classList.add('ok');
  ctx._hooks.syncHashState(ctx);
}
