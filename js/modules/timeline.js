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
    stopPlayback(ctx);
  } else {
    ctx.state.minute = Math.max(0, Math.min(1440, minute));
    ctx.els.timelineTime.textContent = formatMinute(ctx.state.minute);
    ctx.els.timelineSlider.value = String(ctx.state.minute);
    const affected = countAffectedGroups(ctx, ctx.state.minute);
    ctx.els.timelineBadge.textContent = affected > 0
      ? affected + ' grupos afectados en este momento'
      : 'sin grupos afectados en este momento';
  }

  ctx._hooks.refreshFeatureStyles(ctx);
  ctx._hooks.updateHeader(ctx);
  ctx._hooks.updateRanking(ctx);
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
  ctx.els.btnPlay.textContent = 'Play';
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
    bars.push('<rect x="' + x + '" y="0" width="' + w + '" height="10" fill="#c0392b" opacity="' + opacity.toFixed(3) + '"></rect>');
  }
  ctx.els.timelineTrack.innerHTML = bars.join('');
}
