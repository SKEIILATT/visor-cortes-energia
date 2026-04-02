import { formatMinute } from './utils.js';
import { isMetaActiveAt } from './styling.js';

export { isMetaActiveAt };

export function isGroupAffectedAt(ctx, groupKey, minute) {
  const group = ctx.state.groups.get(groupKey);
  if (!group) return false;
  for (let i = 0; i < group.featureIds.length; i += 1) {
    const feat = ctx.state.features[group.featureIds[i]];
    if (!feat || !feat.matchesFilter) continue;
    if (isMetaActiveAt(feat.meta, minute)) return true;
  }
  return false;
}

export function countAffectedGroups(ctx, minute) {
  let c = 0;
  ctx.state.groups.forEach(function (g) {
    if (isGroupAffectedAt(ctx, g.key, minute)) c += 1;
  });
  return c;
}

export function countOutageGroups(ctx) {
  let c = 0;
  ctx.state.groups.forEach(function (g) { if (g.hasOutage) c += 1; });
  return c;
}

export function setMinute(ctx, minute) {
  if (minute < 0) {
    ctx.state.minute = -1;
    ctx.els.timelineTime.textContent = '--:--';
    ctx.els.timelineBadge.textContent = 'sin filtro horario';
    ctx.els.timelineSlider.value = '0';
    ctx.els.timelineContext.textContent = 'Selecciona un momento para explorar intensidad, simultaneidad y zonas afectadas.';
    stopPlayback(ctx);
  } else {
    ctx.state.minute = Math.max(0, Math.min(1440, minute));
    ctx.els.timelineTime.textContent = formatMinute(ctx.state.minute);
    ctx.els.timelineSlider.value = String(ctx.state.minute);
    const affected = countAffectedGroups(ctx, ctx.state.minute);
    ctx.els.timelineBadge.textContent = affected > 0
      ? affected + ' grupos afectados en este momento'
      : 'sin grupos afectados en este momento';
    ctx.els.timelineContext.textContent = buildTemporalNarrative(ctx, ctx.state.minute, affected);
  }

  updateTimelineProgress(ctx);
  ctx._hooks.refreshFeatureStyles(ctx);
  ctx._hooks.updateHeader(ctx);
  ctx._hooks.updateRanking(ctx);
  if (ctx._hooks.renderInsights) ctx._hooks.renderInsights(ctx);
  ctx._hooks.syncHashState(ctx);
}

export function togglePlayback(ctx) {
  if (ctx.state.playTimer) {
    stopPlayback(ctx);
    return;
  }
  if (ctx.state.minute < 0) setMinute(ctx, 0);
  ctx.state.playTimer = window.setInterval(function () {
    let next = ctx.state.minute + (15 * ctx.state.speed);
    if (next > 1440) next = 0;
    setMinute(ctx, next);
  }, 320);
  ctx.els.btnPlay.textContent = 'Pausar';
}

export function stopPlayback(ctx) {
  if (ctx.state.playTimer) {
    clearInterval(ctx.state.playTimer);
    ctx.state.playTimer = null;
  }
  ctx.els.btnPlay.textContent = 'Reproducir';
}

export function setPlaybackSpeed(ctx, speed) {
  ctx.state.speed = speed;
  ctx.els.btnSpd1.classList.toggle('btn-mini-primary', speed === 1);
  ctx.els.btnSpd4.classList.toggle('btn-mini-primary', speed === 4);
  ctx.els.btnSpd8.classList.toggle('btn-mini-primary', speed === 8);
}

export function buildTimelineTrack(ctx) {
  const buckets = ctx.state.analysis.buckets || [];
  const max = Math.max.apply(null, buckets.concat([1]));
  const bars = [];
  for (let i = 0; i < buckets.length; i += 1) {
    const val = buckets[i];
    const opacity = Math.max(0.08, val / max);
    const x = ((i / 96) * 100).toFixed(3);
    const w = (100 / 96).toFixed(3);
    bars.push('<rect x="' + x + '" y="0" width="' + w + '" height="10" rx="0.7" ry="0.7" fill="#c65a3a" opacity="' + opacity.toFixed(3) + '"></rect>');
  }
  ctx.els.timelineTrack.innerHTML = bars.join('');
  ctx.els.timelineTrack.addEventListener('click', function (event) {
    const rect = ctx.els.timelineTrack.getBoundingClientRect();
    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
    const minute = Math.max(0, Math.min(95, Math.floor(ratio * 96))) * 15;
    setMinute(ctx, minute);
  });
  renderTimelineStory(ctx);
  updateTimelineProgress(ctx);
}

export function renderTimelineStory(ctx) {
  renderPeakChips(ctx);
  renderScale(ctx);
}

function renderPeakChips(ctx) {
  const buckets = ctx.state.analysis.buckets || [];
  const peaks = extractPeakBuckets(buckets, 4);
  if (!ctx.els.timelinePeaks) return;
  ctx.els.timelinePeaks.innerHTML = peaks.map(function (peak, idx) {
    return '<button class="timeline-peak-chip" type="button" data-minute="' + peak.minute + '">' +
      '<span class="timeline-peak-index">P' + (idx + 1) + '</span>' +
      '<strong>' + formatMinute(peak.minute) + '</strong>' +
      '<span>' + peak.count + ' grupos</span>' +
    '</button>';
  }).join('');

  const chipEls = ctx.els.timelinePeaks.querySelectorAll('.timeline-peak-chip');
  for (let i = 0; i < chipEls.length; i += 1) {
    chipEls[i].addEventListener('click', function () {
      setMinute(ctx, Number(this.getAttribute('data-minute')));
    });
  }
}

function renderScale(ctx) {
  if (!ctx.els.timelineScale) return;
  ctx.els.timelineScale.innerHTML = [0, 360, 720, 1080, 1440].map(function (minute) {
    const label = minute === 1440 ? '24:00' : formatMinute(minute);
    return '<span>' + label + '</span>';
  }).join('');
}

function extractPeakBuckets(buckets, limit) {
  const ranked = buckets
    .map(function (count, index) { return { count: count, minute: index * 15, index: index }; })
    .sort(function (a, b) { return b.count - a.count; });

  const peaks = [];
  for (let i = 0; i < ranked.length && peaks.length < limit; i += 1) {
    const candidate = ranked[i];
    if (candidate.count <= 0) continue;
    const tooClose = peaks.some(function (peak) {
      return Math.abs(peak.index - candidate.index) < 4;
    });
    if (!tooClose) peaks.push(candidate);
  }
  return peaks;
}

function updateTimelineProgress(ctx) {
  if (!ctx.els.timeline) return;
  const minute = ctx.state.minute < 0 ? 0 : ctx.state.minute;
  ctx.els.timeline.style.setProperty('--tl-progress', ((minute / 1440) * 100).toFixed(2) + '%');
}

function buildTemporalNarrative(ctx, minute, affected) {
  const peakMinute = getPeakMinute(ctx);
  if (affected <= 0) return 'Sin grupos activos a las ' + formatMinute(minute) + '.';
  if (peakMinute === minute) return 'Este es un momento pico de simultaneidad en el sistema.';
  const delta = Math.abs(peakMinute - minute) / 60;
  if (delta <= 1) return 'Estás cerca de la ventana pico del sistema.';
  return 'Momento filtrado con ' + affected + ' grupos activos y lectura espacial detallada.';
}

function getPeakMinute(ctx) {
  const buckets = ctx.state.analysis && ctx.state.analysis.buckets ? ctx.state.analysis.buckets : [];
  let bestIndex = 0;
  for (let i = 1; i < buckets.length; i += 1) {
    if (buckets[i] > buckets[bestIndex]) bestIndex = i;
  }
  return bestIndex * 15;
}
