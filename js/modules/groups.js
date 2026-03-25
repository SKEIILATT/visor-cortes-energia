import { escapeHtml, setStatus } from './utils.js';
import { shouldFeatureBeVisible, refreshFeatureVisibility } from './layers.js';
import { isGroupAffectedAt } from './timeline.js';

export function prepareGroups(ctx) {
  const groups = ctx.state.analysis.groups || [];
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    const slotRanges = [];
    const slotSeen = new Set();

    for (let j = 0; j < g.featureIds.length; j += 1) {
      const fid = g.featureIds[j];
      const meta = ctx.state.analysis.featureMeta && ctx.state.analysis.featureMeta[fid];
      if (!meta || !Array.isArray(meta.slots)) continue;
      for (let k = 0; k < meta.slots.length; k += 1) {
        const s = meta.slots[k];
        const key = s[0] + '_' + s[1];
        if (slotSeen.has(key)) continue;
        slotSeen.add(key);
        slotRanges.push([s[0], s[1]]);
      }
    }

    ctx.state.groups.set(g.key, {
      key: g.key,
      visible: true,
      color: ctx.GROUP_COLORS[i % ctx.GROUP_COLORS.length],
      featureIds: g.featureIds.slice(),
      featureCount: g.featureCount,
      slots: slotRanges,
      slotCount: g.slotCount,
      totalOutageMin: g.totalOutageMin,
      hasOutage: g.hasOutage,
    });
  }
}

export function renderGroupList(ctx) {
  const q = (ctx.els.groupSearch.value || '').trim().toLowerCase();
  const rows = Array.from(ctx.state.groups.values())
    .filter(function (g) { return q ? g.key.toLowerCase().includes(q) : true; })
    .sort(function (a, b) { return a.key.localeCompare(b.key, 'es', { sensitivity: 'base' }); });

  const html = [];
  for (let i = 0; i < rows.length; i += 1) {
    const g = rows[i];
    const visibleFeatures = countVisibleFeaturesInGroup(ctx, g.key);
    const outageH = (g.totalOutageMin / 60).toFixed(1);
    html.push(
      '<div class="group-item ' + (g.visible ? '' : 'off') + '" data-key="' + escapeHtml(g.key) + '">' +
        '<input class="group-check" type="checkbox" ' + (g.visible ? 'checked' : '') + '>' +
        '<span class="group-color" style="background:' + escapeHtml(g.color) + '"></span>' +
        '<span class="group-name" title="' + escapeHtml(g.key) + '">' + escapeHtml(g.key) + '</span>' +
        '<span class="group-meta">' + visibleFeatures + '/' + g.featureCount + ' · ' + outageH + 'h</span>' +
      '</div>'
    );
  }

  ctx.els.groupsList.innerHTML = html.join('');

  const items = ctx.els.groupsList.querySelectorAll('.group-item');
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const key = item.getAttribute('data-key') || '';
    const check = item.querySelector('.group-check');
    check.addEventListener('click', function (event) { event.stopPropagation(); });
    check.addEventListener('change', function () { setGroupVisibility(ctx, key, check.checked); });
    item.addEventListener('click', function () {
      check.checked = !check.checked;
      setGroupVisibility(ctx, key, check.checked);
    });
  }

  const total = ctx.state.groups.size;
  const visible = Array.from(ctx.state.groups.values()).filter(function (g) { return g.visible; }).length;
  ctx.els.groupsVisible.textContent = visible + '/' + total;
}

export function countVisibleFeaturesInGroup(ctx, groupKey) {
  const g = ctx.state.groups.get(groupKey);
  if (!g) return 0;
  let count = 0;
  for (let i = 0; i < g.featureIds.length; i += 1) {
    const feat = ctx.state.features[g.featureIds[i]];
    if (feat && feat.matchesFilter) count += 1;
  }
  return count;
}

export function setAllGroupsVisibility(ctx, visible) {
  ctx.state.groups.forEach(function (g) { g.visible = visible; });
  refreshAfterVisibilityChange(ctx);
}

export function invertGroupsVisibility(ctx) {
  ctx.state.groups.forEach(function (g) { g.visible = !g.visible; });
  refreshAfterVisibilityChange(ctx);
}

export function showAffectedOnly(ctx) {
  if (ctx.state.minute < 0) {
    setStatus(ctx, 'Activa el timeline para usar "Solo afectadas".', 'warn');
    return;
  }
  ctx.state.groups.forEach(function (group) {
    group.visible = isGroupAffectedAt(ctx, group.key, ctx.state.minute);
  });
  refreshAfterVisibilityChange(ctx);
}

export function setGroupVisibility(ctx, groupKey, visible) {
  const g = ctx.state.groups.get(groupKey);
  if (!g) return;
  g.visible = visible;
  refreshAfterVisibilityChange(ctx);
}

export function refreshAfterVisibilityChange(ctx) {
  refreshFeatureVisibility(ctx);
  renderGroupList(ctx);
  ctx._hooks.updateHeader(ctx);
  ctx._hooks.updateRanking(ctx);
  ctx._hooks.syncHashState(ctx);
}
