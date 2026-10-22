// Workout detail page: Garmin-depth view of one workout (stats, route, synced charts, zones, laps).
const paceOf = a => a.type === "running" && a.km ? paceStr(a.min / a.km) : null;
const paceStr = minPerKm => minPerKm == null || !isFinite(minPerKm) ? "–" : `${Math.floor(minPerKm)}:${String(Math.round(minPerKm % 1 * 60)).padStart(2, "0")}`;
const TE_WORD = te => te == null ? "" : te >= 5 ? "Overreaching" : te >= 4 ? "Highly improving" : te >= 3 ? "Improving" : te >= 2 ? "Maintaining" : te >= 1 ? "Some benefit" : "No benefit";

// Route as a plain line (no map tiles can load inside an artifact), scaled to true proportions.
function routeSVG(s) {
  const pts = (s.lat || []).map((la, i) => [la, s.lon[i]]).filter(([a, b]) => a != null && b != null);
  if (pts.length < 2) return "";
  const lat0 = pts.reduce((t, p) => t + p[0], 0) / pts.length, k = Math.cos(lat0 * Math.PI / 180);
  const xs = pts.map(p => p[1] * k), ys = pts.map(p => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 600, H = 300, sc = Math.min((W - 30) / (maxX - minX || 1), (H - 30) / (maxY - minY || 1));
  const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
  const P = xs.map((x, i) => [ox + (x - minX) * sc, oy + (ys[i] - minY) * sc]);
  const d = P.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return `<section class="card"><div class="eyebrow">Route</div><svg viewBox="0 0 ${W} ${H}" width="100%" class="route" aria-label="Route shape"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${P[0][0]}" cy="${P[0][1]}" r="7" fill="var(--ok)" stroke="var(--surface)" stroke-width="2"/><circle cx="${P[P.length - 1][0]}" cy="${P[P.length - 1][1]}" r="7" fill="var(--risk)" stroke="var(--surface)" stroke-width="2"/></svg><div class="legend"><span><i style="background:var(--ok)"></i>Start</span><span><i style="background:var(--risk)"></i>Finish</span><span>Route shape only. Map tiles can't load inside the dashboard.</span></div></section>`;
}

// One chart per metric, all on the same time axis; a shared cursor reads every chart at once.
function metricChart(id, title, t, vals, { color, unit, fmt = v => Math.round(v), invert = false, zones } = {}) {
  const ok = vals.map((v, i) => v == null || t[i] == null ? null : [t[i], v]).filter(Boolean);
  if (ok.length < 5) return "";
  const W = 760, H = 150, L = 44, R = 10, Tp = 10, B = 22, end = t[t.length - 1] || 1;
  const vs = ok.map(p => p[1]).sort((a, b) => a - b), lo = vs[Math.floor(vs.length * .02)], hi = vs[Math.floor(vs.length * .98)];
  const pad = (hi - lo) * .12 || 1, a = lo - pad, b = hi + pad;
  const x = s => L + s / end * (W - L - R), y = v => { const f = (Math.min(b, Math.max(a, v)) - a) / (b - a); return Tp + (invert ? f : 1 - f) * (H - Tp - B); };
  const line = ok.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join(" ");
  const base = invert ? Tp : H - B;
  const area = line + ` L${x(ok[ok.length - 1][0]).toFixed(1)} ${base} L${x(ok[0][0]).toFixed(1)} ${base} Z`;
  const ticks = [a + (b - a) * .15, (a + b) / 2, b - (b - a) * .15];
  const zoneBg = zones ? zones.map((zl, i) => { const zh = zones[i + 1] ?? 999; if (zh < a || zl > b) return ""; const y1 = y(Math.min(zh, b)), y2 = y(Math.max(zl, a)); return `<rect x="${L}" y="${Math.min(y1, y2).toFixed(1)}" width="${W - L - R}" height="${Math.abs(y2 - y1).toFixed(1)}" fill="var(--z${i + 1})" opacity=".09"/>`; }).join("") : "";
  const mins = [...Array(Math.floor(end / 600) + 1)].map((_, i) => i * 600).filter(s => s <= end);
  const avgV = ok.reduce((s, p) => s + p[1], 0) / ok.length;
  return `<section class="card mchart" data-chart="${id}"><div class="mhead"><span class="eyebrow">${title}</span><span class="mread num" data-read>avg ${fmt(avgV)} ${unit}</span></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" data-x0="${L}" data-x1="${W - R}" data-end="${end}" aria-hidden="true">${zoneBg}
      ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join("")}
      ${mins.map(s => `<text x="${x(s).toFixed(1)}" y="${H - 6}" text-anchor="middle">${Math.round(s / 60)}′</text>`).join("")}
      <path d="${area}" fill="${color}" opacity=".14"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
      <line class="cursor" x1="0" x2="0" y1="${Tp}" y2="${H - B}" stroke="var(--ink-2)" stroke-width="1" visibility="hidden"/>
    </svg></section>`;
}

function workoutPage(id) {
  const a = G.activities.find(x => String(x.id) === String(id)), det = (window.W || {})[id];
  if (!a) return `<p class="empty">Workout not found.</p>`;
  const when = new Date(a.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const isRun = a.type === "running" || a.type === "walking", isSwim = a.type === "lap_swimming";
  const stat = (k, v, u = "") => v == null || v === "–" ? "" : `<div class="wstat"><div class="k">${k}</div><div class="val">${v}<small>${u}</small></div></div>`;
  const avgSpeed = a.speed ? a.speed * 3.6 : (a.km && a.min ? a.km / (a.min / 60) : null);
  const stats = stat("Distance", a.km, "km") + stat("Time", hm(a.min)) +
    (isRun ? stat("Avg pace", paceStr(a.min / a.km), "/km") : isSwim ? stat("Avg pace", paceStr(a.min / (a.km * 10)), "/100m") : stat("Avg speed", avgSpeed && avgSpeed.toFixed(1), "km/h")) +
    stat("Avg HR", a.hr, "bpm") + stat("Max HR", a.maxHr, "bpm") + stat("Calories", a.kcal && Math.round(a.kcal), "kcal") +
    stat("Climb", a.climb != null ? Math.round(a.climb) : null, "m") + stat("Cadence", a.cad && Math.round(a.cad), "spm") + stat("Avg power", a.power && Math.round(a.power), "W") +
    stat("Training load", a.load);
  const te = a.te != null ? `<section class="card tecard"><div class="eyebrow">Training effect</div><div class="terow">${[["Aerobic", a.te], ["Anaerobic", a.teAn]].map(([n, v]) => v == null ? "" : `<div><div class="tev num">${v.toFixed(1)}</div><div class="s">${n} · ${TE_WORD(v)}</div><div class="tebar"><div style="width:${v / 5 * 100}%"></div></div></div>`).join("")}</div>${a.teLabel ? `<p class="note">Main benefit: ${a.teLabel.replace(/_/g, " ").toLowerCase()}.</p>` : ""}</section>` : "";
  const zones = a.zoneMins ? (() => { const tot = a.zoneMins.reduce((s, m) => s + m, 0) || 1, b = a.zoneLow || []; return `<section class="card"><div class="eyebrow">Time in heart rate zones</div>${[4, 3, 2, 1, 0].map(i => `<div class="zrow"><span class="zl"><i style="background:var(--z${i + 1})"></i>Zone ${i + 1}<small>${b[i] ?? ""}${b[i + 1] ? "–" + (b[i + 1] - 1) : "+"} bpm</small></span><div class="ztrack"><div style="width:${(a.zoneMins[i] / tot * 100).toFixed(1)}%;background:var(--z${i + 1})"></div></div><span class="num">${hm(a.zoneMins[i])} · ${Math.round(a.zoneMins[i] / tot * 100)}%</span></div>`).join("")}</section>`; })() : "";
  let charts = "", laps = "", route = "";
  if (det) {
    const s = det.series, t = s.t || [];
    route = routeSVG(s);
    const pace = (s.speed || []).map(v => v == null || v < (isSwim ? 0.2 : 0.7) ? null : (isSwim ? 100 / v / 60 : 1000 / v / 60));
    const cad = (s.cad || []).map(v => v == null || v === 0 ? null : v < 120 ? v * 2 : v);
    charts = metricChart("hr", "Heart rate", t, s.hr || [], { color: "var(--risk)", unit: "bpm", zones: a.zoneLow }) +
      (isRun || isSwim ? metricChart("pace", isSwim ? "Pace /100m" : "Pace", t, pace, { color: "var(--accent)", unit: isSwim ? "/100m" : "/km", fmt: paceStr, invert: true })
        : metricChart("speed", "Speed", t, (s.speed || []).map(v => v == null ? null : v * 3.6), { color: "var(--accent)", unit: "km/h", fmt: v => v.toFixed(1) })) +
      metricChart("ele", "Elevation", t, s.ele || [], { color: "var(--ok)", unit: "m" }) +
      (isRun ? metricChart("cad", "Cadence", t, cad, { color: "var(--warn)", unit: "spm" }) : "") +
      metricChart("power", "Power", t, s.power || [], { color: "var(--sp-bike)", unit: "W" });
    const L = det.laps || [];
    if (L.length > 1) laps = `<section class="card"><div class="eyebrow">Laps</div><div class="tablewrap"><table class="laps"><thead><tr><th>#</th><th>Distance</th><th>Time</th><th>${isRun ? "Pace" : isSwim ? "/100m" : "Speed"}</th><th>Avg HR</th><th>Max HR</th>${isRun ? "<th>Cadence</th>" : ""}<th>Climb</th></tr></thead><tbody>${L.map((l, i) => {
      const km = (l.distance || 0) / 1000, mn = (l.duration || 0) / 60;
      return `<tr><td>${i + 1}</td><td>${km.toFixed(2)} km</td><td>${fmtTime(l.duration || 0)}</td><td>${isRun ? paceStr(mn / km) : isSwim ? paceStr(mn / (km * 10)) : (km / (mn / 60)).toFixed(1) + " km/h"}</td><td>${l.averageHR ?? "–"}</td><td>${l.maxHR ?? "–"}</td>${isRun ? `<td>${l.averageRunCadence ? Math.round(l.averageRunCadence) : "–"}</td>` : ""}<td>${l.elevationGain != null ? Math.round(l.elevationGain) + " m" : "–"}</td></tr>`;
    }).join("")}</tbody></table></div></section>`;
  }
  const noDetail = det ? "" : `<section class="card"><p class="empty">Detailed charts are kept for 30 days. This one is older: ask Claude in the chat to load it, and it stays for 14 days.</p>${effortTrace(a)}</section>`;
  const legs = a.legs ? `<section class="card"><div class="eyebrow">${actName(a)} · ${a.legs.length} legs</div><div class="legs">${a.legs.map(l => { const s = sportOf(l), tr = l.type === "transition_v2";
    return `<div class="leg${tr ? " tr" : ""}" style="flex:${Math.max(l.min, 3)};--c:${s.color}"><span class="lt">${tr ? "T" : `<svg viewBox="0 0 24 24">${s.icon}</svg>${sportName(l.type)}`}</span>${tr ? "" : `<span class="num">${hm(l.min)}</span><span class="num s">${l.km} km${l.hr ? " · " + l.hr + " bpm" : ""}</span>`}</div>`; }).join("")}</div></section>` : "";
  return `<div class="wpage"><button class="btn back" data-back>‹ Back</button>
    <header class="whero">${sportChip(a)}<h2>${a.name}</h2><div class="s">${when} · ${a.start}</div></header>
    <section class="card wstats">${stats}</section>${legs}${te}${route}${charts}${zones}${laps}${noDetail}</div>`;
}

// Shared cursor: moving over any chart reads the value at that moment on every chart.
function wireCharts(root) {
  const cs = [...root.querySelectorAll(".mchart")];
  if (!cs.length) return;
  const id = root.dataset.wid, s = (window.W[id] || {}).series || {}, t = s.t || [];
  const read = { hr: i => s.hr?.[i] != null ? Math.round(s.hr[i]) + " bpm" : "–", pace: i => s.speed?.[i] > 0.2 ? paceStr((root.querySelector('[data-chart="pace"] .eyebrow').textContent.includes("100m") ? 100 : 1000) / s.speed[i] / 60) : "–",
    speed: i => s.speed?.[i] != null ? (s.speed[i] * 3.6).toFixed(1) + " km/h" : "–", ele: i => s.ele?.[i] != null ? Math.round(s.ele[i]) + " m" : "–",
    cad: i => s.cad?.[i] ? Math.round(s.cad[i] < 120 ? s.cad[i] * 2 : s.cad[i]) + " spm" : "–", power: i => s.power?.[i] != null ? Math.round(s.power[i]) + " W" : "–" };
  const move = e => {
    const svg = e.currentTarget, r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const px = (e.clientX - r.left) / r.width * vb.width, x0 = +svg.dataset.x0, x1 = +svg.dataset.x1;
    const sec = Math.max(0, Math.min(1, (px - x0) / (x1 - x0))) * +svg.dataset.end;
    let i = t.findIndex(v => v >= sec); if (i < 0) i = t.length - 1;
    cs.forEach(c => { const sv = c.querySelector("svg"), cur = sv.querySelector(".cursor"), xx = x0 + sec / +sv.dataset.end * (x1 - x0); cur.setAttribute("x1", xx); cur.setAttribute("x2", xx); cur.setAttribute("visibility", "visible"); c.querySelector("[data-read]").textContent = `${Math.round(sec / 60)}′ · ${read[c.dataset.chart](i)}`; });
  };
  cs.forEach(c => { const sv = c.querySelector("svg"); sv.addEventListener("pointermove", move); sv.addEventListener("pointerleave", () => cs.forEach(k => k.querySelector(".cursor").setAttribute("visibility", "hidden"))); });
}
