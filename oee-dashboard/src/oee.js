/**
 * OEE = Availability × Performance × Quality
 *
 *   Availability = Run Time / Planned Production Time
 *   Performance  = Average Feed Rate (while running) / Ideal Feed Rate
 *                  (or, when piece counts exist, Total Count / (Ideal Rate × Run Time))
 *   Quality      = Good Count / Total Count
 *
 * Metrics are derived from the stored time-series. Each sample is assumed to
 * describe the machine's state until the next sample (or `now` for the last
 * one), so we can attribute elapsed time and production to each state.
 */
export function computeOee(machine, samples, windowStartMs, windowEndMs, nowMs = Date.now()) {
  const idealRate = machine.ideal_feed_rate || 0;
  const end = Math.min(windowEndMs, nowMs);

  let runMs = 0;
  let stopMs = 0;
  let faultMs = 0;
  let idleMs = 0;
  let feedRateTimeWeighted = 0; // Σ feedRate × runDurationMs

  let firstGood = null;
  let lastGood = null;
  let firstReject = null;
  let lastReject = null;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const segStart = Math.max(s.ts, windowStartMs);
    const segEnd = i + 1 < samples.length ? Math.min(samples[i + 1].ts, end) : end;
    const dur = Math.max(0, segEnd - segStart);

    switch (s.state) {
      case 'running':
        runMs += dur;
        if (s.feed_rate != null) feedRateTimeWeighted += s.feed_rate * dur;
        break;
      case 'stopped':
        stopMs += dur;
        break;
      case 'fault':
        faultMs += dur;
        break;
      default:
        idleMs += dur;
    }

    // Track cumulative counts (counts only ever increase; ignore resets).
    if (s.good_count != null) {
      if (firstGood == null) firstGood = s.good_count;
      lastGood = s.good_count;
    }
    if (s.reject_count != null) {
      if (firstReject == null) firstReject = s.reject_count;
      lastReject = s.reject_count;
    }
  }

  const plannedMs = Math.max(0, end - windowStartMs);
  const downMs = stopMs + faultMs;

  const goodDelta = firstGood != null && lastGood >= firstGood ? lastGood - firstGood : 0;
  const rejectDelta = firstReject != null && lastReject >= firstReject ? lastReject - firstReject : 0;
  const totalCount = goodDelta + rejectDelta;
  const hasCounts = firstGood != null || firstReject != null;

  const availability = plannedMs > 0 ? runMs / plannedMs : 0;

  // Performance is driven by the feed-rate signal (average rate while running
  // vs the ideal rate). Piece counts, when supplied, drive Quality only.
  const avgFeedRate = runMs > 0 ? feedRateTimeWeighted / runMs : 0;
  const performance = idealRate > 0 ? avgFeedRate / idealRate : 0;

  const quality = hasCounts && totalCount > 0 ? goodDelta / totalCount : 1;

  // Cap each factor at 100% for the OEE product (raw values are reported too).
  const aC = clamp01(availability);
  const pC = clamp01(performance);
  const qC = clamp01(quality);
  const oee = aC * pC * qC;

  return {
    oee,
    availability,
    performance,
    quality,
    avgFeedRate,
    idealFeedRate: idealRate,
    runMs,
    stopMs,
    faultMs,
    idleMs,
    downMs,
    plannedMs,
    goodCount: goodDelta,
    rejectCount: rejectDelta,
    totalCount,
    hasCounts,
  };
}

function clamp01(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v > 1 ? 1 : v;
}

export function deriveState(reading) {
  if (reading.fault) return 'fault';
  if (reading.stopped) return 'stopped';
  if (reading.running) return 'running';
  return 'idle';
}
