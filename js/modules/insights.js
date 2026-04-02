import { escapeHtml, formatMinute } from './utils.js';
import { focusGroup } from './ranking.js';

export function renderInsights(ctx) {
  if (!ctx.els.insightsCards || !ctx.state.analysis) return;

  const peak = getPeakBucket(ctx);
  const visibleGroups = Array.from(ctx.state.groups.values()).filter(function (group) { return group.visible; });
  const visibleFeatures = ctx.state.features.filter(function (feat) {
    const group = ctx.state.groups.get(feat.meta.groupKey);
    return !!(group && group.visible && feat.matchesFilter);
  });
  const activeNow = ctx.state.minute >= 0 ? countActiveVisibleGroups(ctx, ctx.state.minute) : countAffectedVisibleGroups(visibleGroups);
  const dominant = getDominantVisibleGroup(visibleGroups);
  const csvCoverage = ctx.state.csvPaint.loaded ? Math.round((ctx.state.csvPaint.rows.size / Math.max(1, ctx.state.features.length)) * 100) : null;

  ctx.els.insightsSummary.textContent =
    ctx.state.minute >= 0
      ? activeNow + ' grupos visibles activos a las ' + formatMinute(ctx.state.minute) + '.'
      : 'Vista general del dataset con ' + visibleFeatures.length + ' polígonos visibles.';

  ctx.els.insightsCaption.textContent =
    ctx.state.csvPaint.loaded && csvCoverage !== null
      ? 'cobertura CSV ' + csvCoverage + '%'
      : 'lectura ejecutiva';

  const cards = [
    {
      title: 'Pico temporal',
      value: peak ? formatMinute(peak.minute) : '-',
      meta: peak ? peak.count + ' grupos simultáneos' : 'sin eventos',
      action: peak ? 'peak' : '',
    },
    {
      title: 'Cobertura visible',
      value: visibleGroups.length + '/' + ctx.state.groups.size,
      meta: 'grupos en análisis',
      action: 'none',
    },
    {
      title: 'Grupo dominante',
      value: dominant ? dominant.key : '-',
      meta: dominant ? (dominant.totalOutageMin / 60).toFixed(1) + ' h acumuladas' : 'sin datos',
      action: dominant ? 'group:' + dominant.key : '',
    },
    {
      title: 'CSV vinculado',
      value: csvCoverage === null ? 'No' : csvCoverage + '%',
      meta: csvCoverage === null ? 'sin tabla auxiliar' : 'polígonos enlazados',
      action: 'none',
    },
  ];

  ctx.els.insightsCards.innerHTML = cards.map(function (card) {
    return '<button class="insight-card" type="button" data-insight="' + escapeHtml(card.action) + '">' +
      '<span class="insight-card-title">' + escapeHtml(card.title) + '</span>' +
      '<strong class="insight-card-value">' + escapeHtml(card.value) + '</strong>' +
      '<span class="insight-card-meta">' + escapeHtml(card.meta) + '</span>' +
    '</button>';
  }).join('');

  const cardEls = ctx.els.insightsCards.querySelectorAll('.insight-card');
  for (let i = 0; i < cardEls.length; i += 1) {
    cardEls[i].addEventListener('click', function () {
      const action = this.getAttribute('data-insight') || '';
      if (action === 'peak' && peak) {
        ctx._hooks.setMinute(ctx, peak.minute);
        return;
      }
      if (action.indexOf('group:') === 0) {
        focusGroup(ctx, action.slice(6));
      }
    });
  }
}

function getPeakBucket(ctx) {
  const buckets = ctx.state.analysis && ctx.state.analysis.buckets ? ctx.state.analysis.buckets : [];
  if (!buckets.length) return null;
  let bestIndex = 0;
  for (let i = 1; i < buckets.length; i += 1) {
    if (buckets[i] > buckets[bestIndex]) bestIndex = i;
  }
  return { index: bestIndex, minute: bestIndex * 15, count: buckets[bestIndex] || 0 };
}

function countAffectedVisibleGroups(groups) {
  let count = 0;
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i].hasOutage) count += 1;
  }
  return count;
}

function countActiveVisibleGroups(ctx, minute) {
  let count = 0;
  ctx.state.groups.forEach(function (group) {
    if (!group.visible) return;
    for (let i = 0; i < group.featureIds.length; i += 1) {
      const feat = ctx.state.features[group.featureIds[i]];
      if (!feat || !feat.matchesFilter) continue;
      const slots = feat.meta.slots || [];
      for (let j = 0; j < slots.length; j += 1) {
        const start = slots[j][0];
        const end = slots[j][1];
        const active = end > start ? (minute >= start && minute < end) : (minute >= start || minute < end);
        if (active) {
          count += 1;
          return;
        }
      }
    }
  });
  return count;
}

function getDominantVisibleGroup(groups) {
  if (!groups.length) return null;
  return groups.slice().sort(function (a, b) {
    return b.totalOutageMin - a.totalOutageMin;
  })[0];
}
