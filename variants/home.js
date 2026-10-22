// Home: coach card, range-switchable tiles with a details pop-up each, workouts list.
const RANGES = [["1w", "7 days"], ["4w", "4 weeks"], ["12w", "12 weeks"], ["52w", "52 weeks"]];
const avg = xs => { const v = xs.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const shortDate = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Daily load = sum of the last 7 days of workout loads (Garmin's own number only exists for recent days).
let LOAD7_; const LOAD7 = () => LOAD7_ ||= (() => { const by = {}; G.activities.forEach(a => by[a.date] = (by[a.date] || 0) + a.load); return Object.fromEntries(ALL.map((d, i) => [d.date, ALL.slice(Math.max(0, i - 6), i + 1).reduce((s, x) => s + (by[x.date] || 0), 0)])); })();
const FIELD = { hrv: d => d.hrv, sleep: d => d.sleepScore, rhr: d => d.rhr, bb: d => d.bbHigh, vo2: d => d.vo2, training: d => LOAD7()[d.date], sleepH: d => d.sleepH, stress: d => d.stress, steps: d => d.steps };

// One series for a card: daily for 1w/4w, weekly averages for 12w/52w.
function series(key, range) {
  const f = FIELD[key];
  if (range === "1w" || range === "4w") {
    const ds = ALL.slice(range === "1w" ? -7 : -28);
    return { vals: ds.map(f), labels: ds.map(d => range === "1w" ? dow(d.date) : shortDate(d.date)), unit: "day" };
  }
  const n = range === "12w" ? 12 : 52, out = { vals: [], labels: [], unit: "week" };
  for (let w = n - 1; w >= 0; w--) {
    const ds = ALL.slice(ALL.length - 7 * (w + 1), ALL.length - 7 * w);
    const v = avg(ds.map(f));
    out.vals.push(v == null ? null : Math.round(v * 10) / 10);
    out.labels.push(shortDate(ds[0].date));
  }
  return out;
}

// Monotone curve (Fritsch–Butland): passes through every point and never overshoots,
// so uneven spacing or a sharp drop can't draw loops or bumps that aren't in the data.
function smooth(pts) {
  const n = pts.length, f = v => v.toFixed(1);
  if (n < 2) return n ? `M${f(pts[0][0])} ${f(pts[0][1])}` : "";
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${f(pts[i][0] + h)} ${f(pts[i][1] + t[i] * h)} ${f(pts[i + 1][0] - h)} ${f(pts[i + 1][1] - t[i + 1] * h)} ${f(pts[i + 1][0])} ${f(pts[i + 1][1])}`;
  }
  return d;
}

// Hover payload: every chart carries its own numbers so one shared handler can read any of them.
// extra: { bars: true, mins } marks a bar chart: the tip shows the total, a split bar and one icon per sport
const hoverAttr = (labels, rows, x0, x1, extra = {}) => `data-hover="${encodeURIComponent(JSON.stringify({ labels, rows, x0, x1, ...extra }))}"`;
const hmShort = m => m >= 60 ? `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)}m`;
function tipHTML(d, i) {
  const [tot, ...sp] = d.rows, on = sp.map((r, j) => [r, SPORTS[j], d.mins[i][j]]).filter(([r]) => r[1][i] !== "–");
  return `<b>${d.labels[i]}</b><div class="tb-tot num">${tot[1][i]}</div><div class="tb-bar">${on.map(([, s, m]) => `<i style="flex:${m};background:${s.color}"></i>`).join("")}</div><div class="tb-leg">${on.map(([r, s]) => `<span><svg viewBox="0 0 24 24" style="color:${s.color}">${s.icon}</svg><span class="num">${r[1][i]}</span></span>`).join("")}</div>`;
}
const GUIDE = `<line class="hguide" x1="0" x2="0" y1="0" y2="100%" visibility="hidden"/>`;

// Axis labels that never collide: keep a label only if it clears the last one drawn; the final label always shows.
function spaced(idx, x, minGap = 46) {
  const every = Math.ceil(idx.length / 12), keep = [], lastI = idx[idx.length - 1];
  idx.filter((i, k) => k % every === 0 || i === lastI).forEach(i => { if (keep.length && x(i) - x(keep[keep.length - 1]) < minGap) { if (i === lastI) keep[keep.length - 1] = i; } else keep.push(i); });
  return keep;
}
function axisLabels(labels, x, y, minGap = 46) {
  return spaced(labels.map((l, i) => i), x, minGap).map(i => `<text x="${x(i).toFixed(1)}" y="${y}" text-anchor="middle">${labels[i]}</text>`).join("");
}

// Line chart with an optional "normal range" band; big adds labels. Long gaps (no data) break the line.
function lineChart(vals, { w = 240, h = 70, band, big = false, color = "var(--accent)", minSpan = 0, labels = [], unit = "", name = "" } = {}) {
  const top = big ? 20 : 6, bottom = big ? 22 : 6, left = 6, right = big ? 30 : 8;
  const nums = vals.filter(v => v != null);
  if (!nums.length) return `<div class="nodata">No data in this range</div>`;
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (band) { lo = Math.min(lo, band[0]); hi = Math.max(hi, band[1]); }
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const x = i => left + i * (w - left - right) / Math.max(1, vals.length - 1), y = v => top + (hi - v) / (hi - lo) * (h - top - bottom);
  const idx = vals.map((v, i) => v == null ? null : i).filter(i => i != null);
  const runs = []; idx.forEach(i => { const r = runs[runs.length - 1]; if (r && i - r[r.length - 1] <= 2) r.push(i); else runs.push([i]); });
  const gid = "g" + Math.random().toString(36).slice(2, 8);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" aria-hidden="true" style="display:block;overflow:visible" ${hoverAttr(labels, [[name, vals, unit]], x(0), x(vals.length - 1))}><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
  if (band) {
    s += `<rect x="${left}" y="${y(band[1]).toFixed(1)}" width="${w - left - right}" height="${(y(band[0]) - y(band[1])).toFixed(1)}" fill="var(--ok)" opacity=".1"/>`;
    s += band.map(b => `<line x1="${left}" x2="${w - right}" y1="${y(b).toFixed(1)}" y2="${y(b).toFixed(1)}" stroke="var(--ok)" stroke-dasharray="3 3" opacity=".6"/>`).join("");
    if (big) s += band.map(b => `<text x="${w - right + 4}" y="${(y(b) + 3).toFixed(1)}">${b}</text>`).join("");
  }
  runs.forEach(r => {
    const pts = r.map(i => [x(i), y(vals[i])]), line = smooth(pts);
    if (pts.length > 1) s += `<path d="${line} L${pts[pts.length - 1][0].toFixed(1)} ${h - bottom} L${pts[0][0].toFixed(1)} ${h - bottom} Z" fill="url(#${gid})"/>`;
    s += `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linecap="round"/>`;
    if (pts.length === 1) s += `<circle cx="${pts[0][0].toFixed(1)}" cy="${pts[0][1].toFixed(1)}" r="2.5" fill="${color}"/>`;
  });
  const shown = new Set(big ? spaced(idx, x, 40) : []);
  idx.forEach((i, k) => {
    const endp = k === idx.length - 1, inBand = !band || (vals[i] >= band[0] && vals[i] <= band[1]);
    const dot = band ? (inBand ? "var(--ok)" : "var(--warn)") : color;
    if ((big && shown.has(i)) || endp) s += `<circle cx="${x(i).toFixed(1)}" cy="${y(vals[i]).toFixed(1)}" r="${endp ? 4.5 : 3}" fill="${endp ? dot : "var(--surface)"}" stroke="${dot}" stroke-width="2"/>`;
    if (big && shown.has(i)) s += `<text x="${x(i).toFixed(1)}" y="${(y(vals[i]) - 10).toFixed(1)}" text-anchor="middle" style="fill:var(--ink-2)">${Math.round(vals[i])}</text>`;
  });
  if (big) s += axisLabels(labels, x, h - 6);
  return s + GUIDE + `</svg>`;
}

function bars(vals, { w = 132, h = 40, color = "var(--accent)", max, labels = [], big = false, unit = "", name = "" } = {}) {
  const m = max || Math.max(...vals.map(v => v || 0)) || 1, gap = vals.length > 30 ? 1 : 4, bw = (w - (vals.length - 1) * gap) / vals.length;
  const lh = big ? 16 : 0, cx = i => i * (bw + gap) + bw / 2;
  return `<svg viewBox="0 0 ${w} ${h + lh}" width="100%" preserveAspectRatio="none" aria-hidden="true" ${hoverAttr(labels, [[name, vals, unit]], cx(0), cx(vals.length - 1))}>` + vals.map((v, i) => {
    const bh = v == null ? 0 : Math.max(2, v / m * (h - 2));
    return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(2, bw / 3).toFixed(1)}" fill="${color}" opacity="${i === vals.length - 1 ? 1 : .45}"/>`;
  }).join("") + (big ? axisLabels(labels, cx, h + 12, 46) : "") + GUIDE + `</svg>`;
}

// One tooltip for the whole page: reads the hovered chart's own numbers at the pointer's position.
(function hover() {
  const tip = document.createElement("div"); tip.className = "htip"; tip.hidden = true;
  document.addEventListener("DOMContentLoaded", () => document.body.append(tip));
  let lastSvg = null;
  const hide = () => { tip.hidden = true; if (lastSvg) { lastSvg.querySelector(".hguide")?.setAttribute("visibility", "hidden"); lastSvg.classList.remove("hovering"); lastSvg.querySelectorAll(".vcol.on").forEach(c => c.classList.remove("on")); } lastSvg = null; };
  document.addEventListener("pointermove", e => {
    // svg charts map the pointer through their viewBox; a plain element (bar columns) splits its width evenly
    const svg = e.target.closest?.("[data-hover]");
    if (!svg) return hide();
    const d = JSON.parse(decodeURIComponent(svg.dataset.hover)), n = d.rows[0][1].length, r = svg.getBoundingClientRect();
    const i = svg.viewBox ? Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width * svg.viewBox.baseVal.width - d.x0) / ((d.x1 - d.x0) || 1) * (n - 1))))
      : Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / r.width * n)));
    const xi = d.x0 + i * (d.x1 - d.x0) / Math.max(1, n - 1);
    if (lastSvg && lastSvg !== svg) lastSvg.querySelector(".hguide")?.setAttribute("visibility", "hidden");
    lastSvg = svg;
    const host = svg.closest("dialog[open]") || document.body; if (tip.parentNode !== host) host.append(tip);
    const g = svg.querySelector(".hguide"); if (g) { g.setAttribute("x1", xi); g.setAttribute("x2", xi); g.setAttribute("visibility", "visible"); }
    if (d.bars) { // bar charts: mark the hovered bar, fade the rest
      if (lastSvg !== svg) hide(); lastSvg = svg; svg.classList.add("hovering");
      svg.querySelectorAll(".vcol").forEach((c, k) => c.classList.toggle("on", k === i));
      tip.innerHTML = tipHTML(d, i); tip.hidden = false;
      tip.style.left = Math.min(document.documentElement.clientWidth - tip.offsetWidth - 8, e.clientX + 14) + "px"; tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 10) + "px";
      return;
    }
    const fmtV = v => v == null ? "no data" : typeof v === "string" ? v : Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1);
    tip.innerHTML = `<b>${d.labels[i] ?? ""}</b>` + d.rows.map(([nm, vs, u]) => `<div>${nm ? `<span>${nm}</span> ` : ""}<span class="num">${fmtV(vs[i])}${vs[i] == null ? "" : " " + u}</span></div>`).join("");
    tip.hidden = false;
    const tx = Math.min(document.documentElement.clientWidth - tip.offsetWidth - 8, e.clientX + 14), ty = Math.max(8, e.clientY - tip.offsetHeight - 10);
    tip.style.left = tx + "px"; tip.style.top = ty + "px";
  });
  document.addEventListener("pointerleave", hide);
})();

function donut(v, { size = 76, stroke = 9, label = "" } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, col = v >= 70 ? "var(--ok)" : v >= 45 ? "var(--warn)" : "var(--risk)";
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true" style="flex:none"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="${label ? size / 2 - size / 14 : size / 2}" text-anchor="middle" dominant-baseline="central" style="fill:var(--ink);font:600 ${Math.round(size / 4)}px var(--f-mono)">${v}</text>${label ? `<text x="50%" y="${size / 2 + size / 6}" text-anchor="middle" style="font-size:${Math.round(size / 11)}px">${label}</text>` : ""}</svg>`;
}

function rangeBar(v, lo, hi, max) {
  const p = n => Math.min(100, n / max * 100);
  const col = v >= lo && v <= hi ? "var(--ok)" : v < lo ? "var(--warn)" : "var(--risk)";
  return `<div class="rbar"><div class="rbar-band" style="left:${p(lo).toFixed(1)}%;width:${(p(hi) - p(lo)).toFixed(1)}%"></div><div class="rbar-fill" style="width:${p(v).toFixed(1)}%;background:${col}"></div></div>`;
}

const seg = (range, cls = "") => `<div class="seg ${cls}" role="group" aria-label="Range">${RANGES.map(([k]) => `<button type="button" data-range="${k}" class="${k === range ? "on" : ""}">${k}</button>`).join("")}</div>`;
const rangeWord = r => RANGES.find(x => x[0] === r)[1];
const fmt = v => v == null ? "–" : Math.round(v);

// ---- tiles: headline is today's number; the sub line and chart follow the chosen range ----
const TILE = {
  hrv: r => { const s = series("hrv", r); return { eyebrow: "HRV", v: last.hrv, unit: "ms", sub: `<span class="pill ${hrvWord[1]}">${hrvWord[0]}</span> avg ${fmt(avg(s.vals))} over ${rangeWord(r)}`, chart: lineChart(s.vals, { w: 240, h: 64, band: [last.hrvLow, last.hrvHigh], labels: s.labels, unit: "ms" }) }; },
  sleep: r => { const s = series("sleep", r); return { eyebrow: "Sleep", v: last.sleepScore, unit: "/100", sub: `${last.sleepH} h last night · avg ${fmt(avg(s.vals))}`, chart: bars(s.vals, { w: 240, h: 56, max: 100, labels: s.labels, unit: "/100" }) }; },
  rhr: r => { const s = series("rhr", r); return { eyebrow: "Resting HR", v: last.rhr, unit: "bpm", sub: `avg ${fmt(avg(s.vals))} over ${rangeWord(r)}`, chart: lineChart(s.vals, { w: 240, h: 64, color: "var(--risk)", minSpan: 16, labels: s.labels, unit: "bpm" }) }; },
  vo2: r => { const s = series("vo2", r); return { eyebrow: "VO2 max", v: T.vo2Run, unit: "run", sub: `Bike ${T.vo2Bike} · ${s.vals.find(v => v != null) ?? "–"} ${rangeWord(r)} ago`, chart: lineChart(s.vals, { w: 240, h: 64, minSpan: 4, labels: s.labels }) }; },
  stress: r => { const s = series("stress", r); return { eyebrow: "Stress", v: fmt(last.stress), unit: "avg", sub: `avg ${fmt(avg(s.vals))} over ${rangeWord(r)} · lower is calmer`, chart: bars(s.vals, { w: 240, h: 56, max: 100, color: "var(--warn)", labels: s.labels }) }; },
  steps: r => { const s = series("steps", r); return { eyebrow: "Steps", v: last.steps != null ? last.steps.toLocaleString() : "–", unit: "today", sub: `avg ${fmt(avg(s.vals))?.toLocaleString?.() ?? "–"} a day over ${rangeWord(r)}`, chart: bars(s.vals, { w: 240, h: 56, color: "var(--ok)", labels: s.labels }) }; },
  training: r => { const s = series("training", r); return { eyebrow: "Training load", v: T.acuteLoad, unit: "7-day", sub: `${statusPill(T.status)} healthy ${T.chronicLow}–${T.chronicHigh}`, chart: r === "1w" ? rangeBar(T.acuteLoad, T.chronicLow, T.chronicHigh, Math.max(T.chronicHigh * 1.3, T.acuteLoad)) : lineChart(s.vals, { w: 240, h: 64, band: [T.chronicLow, T.chronicHigh], labels: s.labels }) }; },
};
function tileHTML(key, r) {
  if (key === "bb") {
    const s = series("bb", r);
    return `<div class="card tile" data-key="bb" tabindex="0" role="button"><div class="thead"><div class="eyebrow">Body battery</div>${seg(r)}</div><div class="bbrow"><div><div class="s">Charged to ${last.bbHigh} overnight</div><div class="s">Lowest ${last.bbLow} today</div><div class="s">Avg high ${fmt(avg(s.vals))} over ${rangeWord(r)}</div></div>${donut(last.bbHigh, { size: 84, stroke: 10 })}</div>${r === "1w" ? "" : `<div class="chart">${bars(s.vals, { w: 240, h: 28, max: 100, labels: s.labels })}</div>`}</div>`;
  }
  const t = TILE[key](r);
  return `<div class="card tile" data-key="${key}" tabindex="0" role="button"><div class="thead"><div class="eyebrow">${t.eyebrow}</div>${seg(r)}</div><div class="v num">${t.v}<small>${t.unit}</small></div><div class="s">${t.sub}</div><div class="chart">${t.chart}</div></div>`;
}

// ---- pop-ups: same range switch, bigger charts ----
const DETAILS = {
  hrv: r => { const s = series("hrv", r); return `<h3>HRV</h3><p class="lead">Last night <b class="num">${last.hrv} ms</b>. Your normal range is ${last.hrvLow}–${last.hrvHigh}. Average over ${rangeWord(r)}: <b class="num">${fmt(avg(s.vals))}</b>${s.unit === "week" ? " (weekly averages)" : ""}.</p>${lineChart(s.vals, { w: 560, h: 210, band: [last.hrvLow, last.hrvHigh], big: true, labels: s.labels, unit: "ms" })}<p class="note">Green is inside your normal range, amber is under it. Nights without the watch are skipped.</p>`; },
  sleep: r => { const s = series("sleep", r), hs = series("sleepH", r); return `<h3>Sleep</h3><p class="lead">Last night <b class="num">${last.sleepScore}/100</b>, ${last.sleepH} h asleep. Over ${rangeWord(r)}: score <b class="num">${fmt(avg(s.vals))}</b>, <b class="num">${(avg(hs.vals) || 0).toFixed(1)} h</b> a night.</p>${lineChart(s.vals, { w: 560, h: 200, big: true, band: [80, 100], labels: s.labels, unit: "/100" })}${r === "1w" && last.stages ? `<div class="k" style="margin-top:14px">Last night's stages</div><div class="stages">${["Deep", "Light", "REM", "Awake"].map((n, i) => `<div style="flex:${last.stages[i] || 0.01}" class="st st${i}"><span>${n} ${hm(last.stages[i])}</span></div>`).join("")}</div>` : ""}`; },
  rhr: r => { const s = series("rhr", r); return `<h3>Resting heart rate</h3><p class="lead"><b class="num">${last.rhr} bpm</b> today. Average over ${rangeWord(r)}: <b class="num">${fmt(avg(s.vals))}</b>. Lower usually means better recovered.</p>${lineChart(s.vals, { w: 560, h: 210, big: true, color: "var(--risk)", minSpan: 16, labels: s.labels, unit: "bpm" })}`; },
  bb: r => { const ds = ALL.slice(r === "1w" ? -7 : -28), s = series("bb", r);
    return `<h3>Body battery</h3><div class="bbtop">${donut(last.bbHigh, { size: 130, stroke: 14, label: "today's high" })}<p class="lead">Charged to <b class="num">${last.bbHigh}</b> overnight and down to <b class="num">${last.bbLow}</b> by the end of the day. Average high over ${rangeWord(r)}: <b class="num">${fmt(avg(s.vals))}</b>.</p></div>` +
      (r === "1w" || r === "4w" ? `<div class="ranges">${ds.map(d => `<div class="rrow"><span class="num">${r === "1w" ? dow(d.date) : shortDate(d.date)}</span><div class="rtrack">${d.bbHigh != null ? `<div class="rspan" style="left:${d.bbLow}%;width:${d.bbHigh - d.bbLow}%"></div>` : ""}</div><span class="num">${d.bbHigh != null ? d.bbLow + "–" + d.bbHigh : "–"}</span></div>`).join("")}</div>` : bars(s.vals, { w: 560, h: 160, max: 100, big: true, labels: s.labels })); },
  stress: r => { const s = series("stress", r); return `<h3>Stress</h3><p class="lead">Average stress <b class="num">${fmt(last.stress)}</b> yesterday. Over ${rangeWord(r)}: <b class="num">${fmt(avg(s.vals))}</b>. Under 25 is resting, over 50 is high.</p>${lineChart(s.vals, { w: 560, h: 200, big: true, color: "var(--warn)", band: [0, 25], labels: s.labels })}`; },
  steps: r => { const s = series("steps", r); return `<h3>Steps</h3><p class="lead"><b class="num">${last.steps?.toLocaleString() ?? "–"}</b> today. Average over ${rangeWord(r)}: <b class="num">${Math.round(avg(s.vals) || 0).toLocaleString()}</b> a day.</p>${bars(s.vals, { w: 560, h: 170, big: true, color: "var(--ok)", labels: s.labels })}`; },
  vo2: r => { const s = series("vo2", r); return `<h3>VO2 max</h3><p class="lead">Running <b class="num">${T.vo2Run}</b>, cycling <b class="num">${T.vo2Bike}</b>. Garmin updates it after outdoor runs and rides with heart rate.</p>${lineChart(s.vals, { w: 560, h: 210, big: true, minSpan: 4, labels: s.labels })}`; },
  training: r => { const s = series("training", r); return `<h3>Training load</h3><p class="lead">${statusPill(T.status)} Your last 7 days add up to a load of <b class="num">${T.acuteLoad}</b>. Garmin's healthy range for you is ${T.chronicLow}–${T.chronicHigh}.</p>
    <div class="k">7-day load</div>${rangeBar(T.acuteLoad, T.chronicLow, T.chronicHigh, Math.max(T.chronicHigh * 1.3, T.acuteLoad))}
    <div class="k" style="margin-top:16px">7-day load over ${rangeWord(r)}</div>${lineChart(s.vals, { w: 560, h: 180, big: true, band: [T.chronicLow, T.chronicHigh], labels: s.labels })}
    <div class="k" style="margin-top:16px">Load focus · last 4 weeks</div>${T.focus.map(([n, v, lo, hi]) => `<div class="frow"><span>${n}</span>${rangeBar(v, lo, hi, Math.max(hi * 1.3, v))}<span class="num">${v}</span></div>`).join("")}<p class="note">${balanceWord}. The shaded part of each bar is Garmin's target. Older load is added up from your workouts.</p>`; },
};

function workoutRow(a) {
  const kv = (k, v, u = "") => `<div><div class="k">${k}</div><div class="val">${v ?? "–"}<small>${u}</small></div></div>`;
  return `<details><summary><span class="d">${dow(a.date)}<b>${+a.date.slice(8)}</b></span><span class="w">${sportChip(a)}<span class="wname">${a.name}</span></span><span class="wmeta num">${a.km} km · ${hm(a.min)}</span><svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></summary><div class="detail">${effortTrace(a)}${kv("Distance", a.km, "km")}${kv("Time", hm(a.min))}${paceOf(a) ? kv("Pace", paceOf(a), "/km") : ""}${kv("Avg HR", a.hr, "bpm")}${kv("Load", a.load)}<div class="more"><button class="btn" data-workout="${a.id}">Full details ›</button></div></div></details>`;
}

// Time and distance per sport for a list of workouts. Walks count as runs; anything that is not
// run, ride or swim is lumped into Other and shows time only. Icons are DBT's (lucide footprints, bike, waves).
const SPORTS = [
  { key: "run", name: "Run", color: "var(--sp-run)", types: ["running", "walking", "hiking", "trail_running", "treadmill_running"], icon: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>' },
  { key: "bike", name: "Ride", color: "var(--sp-bike)", types: ["cycling", "indoor_cycling", "road_biking", "mountain_biking", "virtual_ride"], icon: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>' },
  { key: "swim", name: "Swim", color: "var(--sp-swim)", types: ["lap_swimming", "open_water_swimming"], icon: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>' },
  { key: "other", name: "Other", color: "var(--sp-other)", types: null, icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
];
const sportOf = a => SPORTS.find(s => s.types?.includes(a.type)) || SPORTS[3];
// A multi-sport activity (or planned session) is its legs; anything else is itself.
const parts = a => a.legs?.length ? a.legs.map(l => ({ ...l, date: a.date })) : [a];
const mainSports = xs => [...new Map(xs.flatMap(parts).map(sportOf).filter(s => s.key !== "other").map(s => [s.key, s])).values()];
// Triathlon = swim, bike and run; brick = bike then run (one activity, or a run starting within 30 min of a ride ending).
function comboName(xs) {
  const ks = new Set(mainSports(xs).map(s => s.key));
  if (ks.has("swim") && ks.has("bike") && ks.has("run")) return "Triathlon";
  const mins = t => t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null, ps = xs.flatMap(parts);
  const brick = xs.some(a => a.legs) ? ks.size === 2 && ks.has("bike") && ks.has("run")
    : ps.some(b => sportOf(b).key === "bike" && ps.some(r => sportOf(r).key === "run" && mins(r.start) != null && mins(b.start) != null && mins(r.start) - (mins(b.start) + b.min) <= 30 && mins(r.start) >= mins(b.start)));
  return brick ? "Brick" : null;
}
const actName = a => a.legs ? comboName([a]) || mainSports([a]).map(s => s.name).join(" + ") || "Multi-sport" : sportName(a.type);
const icons = ss => ss.slice(0, 3).map(s => `<svg viewBox="0 0 24 24" style="color:${s.color}">${s.icon}</svg>`).join("");
const sportChip = a => { const ss = a.legs ? mainSports([a]) : [sportOf(a)], c = ss[0]?.color || "var(--sp-other)";
  return `<span class="chip sport" style="color:${c};background:color-mix(in srgb, ${c} 16%, transparent)">${icons(ss)}${actName(a)}</span>`; };
// The week's total leads; under it one quiet row per sport: icon, name, share bar, time, km.
function sportTotals(acts) {
  const t = SPORTS.map(s => ({ ...s, min: 0, km: 0 }));
  acts.flatMap(parts).forEach(a => { const s = t.find(s => s.key === sportOf(a).key); s.min += a.min; s.km += a.km || 0; });
  const total = t.reduce((n, s) => n + s.min, 0), km = t.reduce((n, s) => n + s.km, 0), on = t.filter(s => s.min);
  const ic = s => `<svg viewBox="0 0 24 24" style="color:${s.color}">${s.icon}</svg>`;
  const head = `<div class="wtot"><b class="num">${total ? hm(total) : "–"}</b><span class="num">${km.toFixed(1)} km · ${acts.length} done</span></div>`;
  return `<div class="sports">${head}${on.map(s => `<div class="srow">${ic(s)}<span class="sn">${s.name}</span><span class="sb"><i style="width:${(s.min / (total || 1) * 100).toFixed(1)}%;background:${s.color}"></i></span><span class="num">${hm(s.min)}</span><span class="num">${s.key !== "other" ? `${s.km.toFixed(1)} km` : ""}</span></div>`).join("")}</div>`;
}

// Planned sessions still ahead (today counts until something is done). Comes from the weekly plan file.
function planAhead() {
  const today = ALL[ALL.length - 1].date;
  return (window.PLAN?.sessions || []).filter(p => p.date > today || (p.date === today && !G.activities.some(a => a.date === today)));
}

// DBT's training week: one bar per day (done solid in the sport's colour, planned faded),
// planned-vs-done line on top, the day's sport under each bar. A day opens its workouts below.
function weekCard(mon, sel = "") {
  const today = ALL[ALL.length - 1].date, days = [...Array(7)].map((_, i) => isoAdd(mon, i));
  const acts = G.activities.filter(a => a.date >= days[0] && a.date <= days[6]);
  const plan = planAhead().filter(p => p.date >= days[0] && p.date <= days[6]);
  const sum = (xs, d) => xs.filter(x => x.date === d).reduce((n, x) => n + x.min, 0);
  const dayMin = days.map(d => sum(acts, d) + sum(plan, d)), max = Math.max(...dayMin, 1);
  const done = acts.reduce((n, a) => n + a.min, 0), planned = done + plan.reduce((n, p) => n + p.min, 0);
  const isNow = mon === mondayOf(today), range = `${shortDate(days[0])} – ${shortDate(days[6])}`;
  const cols = days.map((d, i) => {
    const da = acts.filter(a => a.date === d), dp = plan.filter(p => p.date === d), first = da[0] || dp[0], n = da.length + dp.length;
    const ss = mainSports([...da, ...dp]), s = ss[0] || (first && sportOf(first)), combo = comboName([...da, ...dp]) || comboName(dp);
    const segs = [...da.flatMap(parts).map(a => [a.min, sportOf(a).color, ""]), ...dp.flatMap(parts).map(p => [p.min, sportOf(p).color, "plan"])];
    const bar = n ? `<span class="stack" style="height:${Math.max(16, dayMin[i] / max * 100)}%">${segs.map(([m, c, k]) => `<i class="${k}" style="flex:${m};--c:${c}"></i>`).join("")}</span>` : `<span class="none"></span>`;
    return `<button type="button" class="wkd${d === sel ? " on" : ""}${d === today ? " today" : ""}${d > today ? " ahead" : ""}" data-hday="${d}" ${n ? "" : "disabled"} aria-label="${fmtDate(d)}: ${n ? hm(dayMin[i]) : "rest"}">
      <span class="tick">${da.length && !dp.length ? "✓" : ""}</span><span class="vb">${bar}</span>
      <span class="dl">${dow(d)[0]}</span><span class="dd num">${+d.slice(8)}</span>
      <span class="what" style="color:${s ? s.color : "var(--ink-3)"}">${s ? `${icons(ss.length ? ss.slice(0, 2) : [s])}${combo || (ss.length > 1 ? ss.slice(0, 2).map(x => x.name).join(" + ") : (s.key === "other" ? actName(first) : s.name) + (n > 1 ? ` +${n - 1}` : ""))}` : "Rest"}</span>
      <span class="mins num">${n ? hm(dayMin[i]) : ""}</span></button>`;
  }).join("");
  const planRow = p => `<div class="prow"><span class="d">${dow(p.date)}<b>${+p.date.slice(8)}</b></span><span class="w">${sportChip(p)}<span class="wname">${p.title}</span><span class="tag">Planned</span></span><span class="wmeta num">${hm(p.min)}</span></div>`;
  const rows = d => acts.filter(a => !d || a.date === d).map(workoutRow).join("") + plan.filter(p => !d || p.date === d).map(planRow).join("");
  return `<section class="card week" data-mon="${mon}" data-sel="${sel}"><header><div><div class="eyebrow">${isNow ? "This week · " : ""}${range}</div></div>
      <div class="pager">${isNow ? "" : `<button type="button" data-hweek="${mondayOf(today)}">This week</button>`}<button type="button" data-hweek="${isoAdd(mon, -7)}" aria-label="Previous week">‹</button><button type="button" data-hweek="${isoAdd(mon, 7)}" aria-label="Next week" ${isoAdd(mon, 7) > ((window.PLAN?.sessions || []).map(p => p.date).sort().pop() || today) ? "disabled" : ""}>›</button></div></header>
    ${plan.length ? `<div class="pvd"><p>Planned vs done · <b class="num">${hm(done)} of ${hm(planned)}</b> ${window.PLAN?.status === "draft" ? `<span class="tag">Waiting for your OK</span>` : ""}</p><div class="pbar"><i style="width:${(done / planned * 100).toFixed(1)}%"></i></div></div>` : ""}
    ${sportTotals(acts)}
    <div class="wkcols">${cols}</div>
    ${sel ? `<div class="wlist">${rows(sel)}</div>` : `<details class="allw"><summary>All ${acts.length + plan.length} sessions this week</summary>${rows("")}</details>`}</section>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-hday],[data-hweek]"); if (!b) return;
  const card = b.closest(".week"), mon = b.dataset.hweek || card.dataset.mon;
  const sel = b.dataset.hweek ? "" : card.dataset.sel === b.dataset.hday ? "" : b.dataset.hday;
  card.outerHTML = weekCard(mon, sel);
});

// Home cards Settings can move, hide or add. Tiles that sit next to each other share one grid.
const CARDS = { season: "Race or season", week: "This week", hrv: "HRV", sleep: "Sleep", rhr: "Resting HR", bb: "Body battery", vo2: "VO2 max", training: "Training load", stress: "Stress", steps: "Steps" };
function homeMain() {
  const out = []; let grid = [];
  const flush = () => { if (grid.length) out.push(`<div class="tiles">${grid.join("")}</div>`); grid = []; };
  SETTINGS.cards.forEach(k => {
    if (k === "season") { flush(); out.push(seasonCard(SETTINGS.race)); }
    else if (k === "week") { flush(); out.push(weekCard(mondayOf(ALL[ALL.length - 1].date))); }
    else if (CARDS[k]) grid.push(tileHTML(k, "1w"));
  });
  flush();
  return coachCard() + out.join("");
}
function H() {
  return `<div class="screen H">${topBar}<main class="main" data-view="home">${homeMain()}</main>${tabs}<dialog class="pop"><button class="x" aria-label="Close">×</button><div class="body"></div></dialog></div>`;
}

// Tiles and pop-ups: a range button re-draws only its own card; anywhere else opens the pop-up.
const WIRED = new WeakSet();
function wirePops(root) {
  root.querySelectorAll(".tile[data-key]").forEach(tile => {
    if (WIRED.has(tile)) return; WIRED.add(tile);
    tile.addEventListener("click", e => {
      const rb = e.target.closest("[data-range]");
      if (rb) { e.stopPropagation(); const t = document.createElement("div"); t.innerHTML = tileHTML(tile.dataset.key, rb.dataset.range); const n = t.firstElementChild, parent = tile.parentElement; tile.replaceWith(n); wirePops(parent); return; }
      const dlg = tile.closest(".screen").querySelector("dialog.pop"), r = tile.querySelector(".seg .on").dataset.range;
      dlg.dataset.key = tile.dataset.key;
      dlg.querySelector(".body").innerHTML = seg(r, "big") + DETAILS[tile.dataset.key](r);
      dlg.showModal();
    });
  });
  root.querySelectorAll("dialog.pop").forEach(dlg => {
    if (WIRED.has(dlg)) return; WIRED.add(dlg);
    dlg.querySelector(".x").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", e => {
      if (e.target === dlg) return dlg.close();
      const rb = e.target.closest("[data-range]");
      if (rb) dlg.querySelector(".body").innerHTML = seg(rb.dataset.range, "big") + DETAILS[dlg.dataset.key](rb.dataset.range);
    });
  });
}
