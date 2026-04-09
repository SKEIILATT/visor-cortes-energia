import { escapeHtml, formatMinute } from './utils.js';
import { isGroupAffectedAt } from './timeline.js';

export function updateRanking(ctx) {
  const rows = [];

  ctx.state.groups.forEach(function (group) {
    if (!group.visible) return;
    let metric;
    let label;
    if (ctx.state.minute >= 0) {
      const active = isGroupAffectedAt(ctx, group.key, ctx.state.minute);
      if (!active) return;
      metric = group.totalOutageMin;
      label = 'Activa en ' + formatMinute(ctx.state.minute);
    } else {
      if (!group.hasOutage) return;
      metric = group.totalOutageMin;
      label = (metric / 60).toFixed(1) + 'h acumuladas';
    }
    rows.push({ key: group.key, metric: metric, label: label });
  });

  rows.sort(function (a, b) { return b.metric - a.metric; });

  const top = rows.slice(0, 8);
  const max = top.length ? top[0].metric : 1;

  if (!ctx.els.rankList) return;
  if (ctx.els.rankTitle) ctx.els.rankTitle.textContent = ctx.state.minute >= 0 ? 'Prioridad temporal' : 'Jerarquía de exposición';
  if (ctx.els.rankSub) ctx.els.rankSub.textContent = ctx.state.mode === 'outage' ? 'lectura por intensidad horaria' : 'lectura por agrupación';

  if (!top.length) {
    ctx.els.rankList.innerHTML = '<p class="muted">No hay datos para este estado.</p>';
    return;
  }

  const parts = [];
  for (let i = 0; i < top.length; i += 1) {
    const row = top[i];
    const pct = Math.max(8, Math.round((row.metric / max) * 100));
    parts.push(
      '<div class="rank-item" data-key="' + escapeHtml(row.key) + '">' +
        '<div class="rank-name">' + (i + 1) + '. ' + escapeHtml(row.key) + '</div>' +
        '<div class="rank-bar-wrap"><div class="rank-bar" style="width:' + pct + '%"></div></div>' +
        '<div class="rank-sub">' + escapeHtml(row.label) + '</div>' +
      '</div>'
    );
  }

  ctx.els.rankList.innerHTML = parts.join('');

  const items = ctx.els.rankList.querySelectorAll('.rank-item');
  for (let i = 0; i < items.length; i += 1) {
    items[i].addEventListener('click', function () {
      const key = items[i].getAttribute('data-key');
      focusGroup(ctx, key);
    });
  }
}

export function focusGroup(ctx, groupKey) {
  const group = ctx.state.groups.get(groupKey);
  if (!group || !group.featureIds.length) return;

  let firstVisibleId = group.featureIds[0];
  for (let i = 0; i < group.featureIds.length; i += 1) {
    const id = group.featureIds[i];
    const feat = ctx.state.features[id];
    if (feat && feat.matchesFilter) {
      firstVisibleId = id;
      break;
    }
  }

  const feat = ctx.state.features[firstVisibleId];
  if (!feat) return;

  ctx._hooks.openInfoPanel(ctx, firstVisibleId);

  if (feat.layer && typeof feat.layer.getBounds === 'function') {
    const b = feat.layer.getBounds();
    if (b && b.isValid()) ctx.state.map.fitBounds(b.pad(0.25));
  }
}
