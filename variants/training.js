// Training tab (week strip, month calendar, day view, effort trace), Progress chapters, season card.
const ZONE_NAMES = ["Below zone 1", "Zone 1 · warm-up", "Zone 2 · easy", "Zone 3 · aerobic", "Zone 4 · threshold", "Zone 5 · max"];
const isoAdd = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = iso => { const d = new Date(iso + "T12:00:00"); return isoAdd(iso, -((d.getDay() + 6) % 7)); };
const dayOf = iso => ALL.find(d => d.date === iso);
const hm = m => m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)} min`;
const fmtTime = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

// What the athlete DID: one bar per stretch spent in a zone, height = zone.
function effortTrace(a) {
  if (!a.stretches || !a.stretches.length) return "";
  const end = a.stretches[a.stretches.length - 1][2], w = 600, h = 64;
  const bars = a.stretches.map(([z, s, e]) => {
    const bh = 10 + z * 10;
    return `<rect x="${(s / end * w).toFixed(1)}" y="${h - bh}" width="${Math.max(1, (e - s) / end * w - 1).toFixed(1)}" height="${bh}" rx="2" fill="var(--z${Math.max(1, z)})"><title>${ZONE_NAMES[z]}</title></rect>`;
  }).join("");
  const mins = a.zoneMins || [];
  const legend = mins.map((m, i) => m >= 1 ? `<span><i style="background:var(--z${i + 1})"></i>Z${i + 1} ${Math.round(m)}′</span>` : "").join("");
  return `<div class="trace"><div class="k">Effort · time in each heart rate zone</div><svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg><div class="zleg">${legend}</div></div>`;
}

// Where you are in the season, from the race saved in Settings. Phase by weeks to go.
const PHASES = [["Base", 8], ["Build", 10], ["Peak", 4], ["Taper", 2]];
function racePhase(race, today = ALL[ALL.length - 1].date) {
  if (!race?.date) return null;
  const days = Math.round((new Date(race.date + "T12:00:00") - new Date(today + "T12:00:00")) / 864e5), weeks = Math.ceil(days / 7);
  if (days < -14) return null;
  const phase = days < 0 ? "Recovery" : days <= 7 ? "Race week" : weeks <= 2 ? "Taper" : weeks <= 6 ? "Peak" : weeks <= 16 ? "Build" : "Base";
  return { days, weeks, phase };
}
function seasonCard(race) {
  const p = racePhase(race);
  if (!p) return `<section class="season card"><div class="srow"><span class="phase base">General health</span><span class="s">No race set. Plans keep you fit without building to a date.</span><button class="btn" data-tab="settings">Add a race</button></div></section>`;
  const total = PHASES.reduce((s, b) => s + b[1], 0), at = Math.max(0, Math.min(total, total - p.weeks));
  const when = new Date(race.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const left = p.days < 0 ? `${-p.days} days ago` : p.days === 0 ? "today" : p.days <= 7 ? `in ${p.days} days` : `${p.weeks} weeks to go`;
  return `<section class="season card"><div class="srow"><span class="phase ${p.phase.toLowerCase().replace(" ", "")}">${p.phase.toUpperCase()}</span><span class="s"><b>${race.name || "Race"}</b> · ${[race.type, when, left].filter(Boolean).join(" · ")}</span><button class="btn" data-tab="settings">Change</button></div><div class="blocks">${PHASES.map(([n, wks]) => `<div style="flex:${wks}" class="blk ${n.toLowerCase()}"><span>${n}</span></div>`).join("")}<div class="you" style="left:${(at / total * 100).toFixed(1)}%"></div></div></section>`;
}

// ----- Progress -----
function fitnessSeries() {
  const byDay = {}; G.activities.forEach(a => byDay[a.date] = (byDay[a.date] || 0) + a.load);
  let ctl = 0, atl = 0;
  return ALL.map(d => { const L = byDay[d.date] || 0, form = ctl - atl; ctl += (L - ctl) / 42; atl += (L - atl) / 7; return { date: d.date, load: L, ctl, atl, form }; });
}
const FORM_ZONES = [
  { lo: 25, label: "Transition", range: "> +25", text: "Form too high, fitness is falling.", color: "#D9A62E", pill: "warn" },
  { lo: 5, label: "Fresh", range: "+5 to +25", text: "Recovered. Race or peak sessions.", color: "var(--ok)", pill: "ok" },
  { lo: -10, label: "Grey zone", range: "-10 to +5", text: "Fit and lightly loaded. Endurance.", color: "var(--ink-3)", pill: "ok" },
  { lo: -30, label: "Optimal", range: "-30 to -10", text: "Where base and build live.", color: "#3BB5D6", pill: "ok" },
  { lo: -Infinity, label: "High risk", range: "< -30", text: "Overreaching. Back off.", color: "var(--risk)", pill: "risk" },
];
const formZone = f => FORM_ZONES.find(z => f >= z.lo);
function formWord(f) { const z = formZone(f); return [z.label, z.pill]; }

// One Progress card, each with its own switch: fitness and volume take a range, bests take a sport.
// The card re-draws itself in place (data-pcard), so one switch never resets the others.
function progressView(ch, r = ch === "bests" ? "run" : "12w") {
  const N = { "1w": 7, "4w": 28, "12w": 84, "52w": 364 }[r], WK = N / 7;
  const FA = fitnessSeries(), F = FA.slice(-N), now = FA[FA.length - 1], today = ALL[ALL.length - 1].date;
  let body = "";
  if (ch === "fitness") {
    // Same shape as DBT's load chart: fitness (filled) and fatigue (dashed) on top,
    // form below with each zone's colour filling the area between the line and zero.
    const w = 760, l = 34, rr = 8, n = F.length, x = i => l + i * (w - l - rr) / Math.max(1, n - 1);
    const t1 = 10, h1 = 190, t2 = 222, h2 = 360, bt = 382;
    const top = Math.ceil(Math.max(...F.map(f => Math.max(f.ctl, f.atl)), 10) / 10) * 10;
    const y1 = v => t1 + (1 - v / top) * (h1 - t1);
    const flo = Math.min(0, ...F.map(f => f.form)), fhi = Math.max(0, ...F.map(f => f.form)), pad = Math.max(1, fhi - flo) * .08;
    const fmin = flo - pad, fmax = fhi + pad, y2 = v => t2 + (1 - (v - fmin) / (fmax - fmin)) * (h2 - t2);
    const step = fmax - fmin <= 25 ? 10 : fmax - fmin <= 120 ? 20 : 40, fticks = [];
    for (let v = Math.ceil(fmin / step) * step; v <= fmax; v += step) fticks.push(v);
    const grid = (vs, y) => vs.map(v => `<line x1="${l}" x2="${w - rr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/><text x="${l - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v}</text>`).join("");
    const pts = (k, y) => F.map((f, i) => `${x(i).toFixed(1)},${y(f[k]).toFixed(1)}`).join(" ");
    const cid = "fz" + Math.random().toString(36).slice(2, 7), z0 = y2(0);
    const bands = FORM_ZONES.map((z, i) => { const hi = i ? FORM_ZONES[i - 1].lo : Infinity, ty = y2(Math.min(hi, fmax)), by = y2(Math.max(z.lo, fmin)); return by > ty ? `<rect x="${l}" y="${ty.toFixed(1)}" width="${w - l - rr}" height="${(by - ty).toFixed(1)}" fill="${z.color}" opacity=".18"/>` : ""; }).join("");
    // each day-pair splits at its midpoint and each half takes its own end's zone colour
    const formLine = F.slice(1).map((f, i) => { const xa = x(i), ya = y2(F[i].form), xb = x(i + 1), yb = y2(f.form), mx = (xa + xb) / 2, my = (ya + yb) / 2;
      return `<line x1="${xa.toFixed(1)}" y1="${ya.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="${formZone(F[i].form).color}"/><line x1="${mx.toFixed(1)}" y1="${my.toFixed(1)}" x2="${xb.toFixed(1)}" y2="${yb.toFixed(1)}" stroke="${formZone(f.form).color}"/>`; }).join("");
    const labels = F.map(f => shortDate(f.date));
    const rows = [["Fitness", F.map(f => Math.round(f.ctl)), ""], ["Fatigue", F.map(f => Math.round(f.atl)), ""], ["Form", F.map(f => Math.round(f.form)), ""]];
    const nz = formZone(now.form);
    body = `<section class="card" data-pcard="fitness"><div class="thead"><div class="eyebrow">Endurance load · fitness, fatigue &amp; form</div>${seg(r)}</div>
      <div class="legend"><span><i style="background:var(--accent)"></i>Fitness <b class="num">${Math.round(now.ctl)}</b></span><span><i style="background:none;border:1.5px dashed var(--ink-3)"></i>Fatigue <b class="num">${Math.round(now.atl)}</b></span><span><i style="background:${nz.color}"></i>Form <b class="num">${now.form > 0 ? "+" : ""}${Math.round(now.form)}</b> · ${nz.label}</span></div>
      <svg viewBox="0 0 ${w} ${bt}" width="100%" aria-hidden="true" style="display:block;margin-top:10px;overflow:visible" ${hoverAttr(labels, rows, x(0), x(n - 1))}>
      ${grid([top, top / 2, 0], y1)}
      <path d="M${x(0)},${y1(0)} L${pts("ctl", y1).replace(/ /g, " L")} L${x(n - 1)},${y1(0)} Z" fill="var(--accent)" opacity=".14"/>
      <polyline points="${pts("ctl", y1)}" fill="none" stroke="var(--accent)" stroke-width="2.25" stroke-linejoin="round"/>
      <polyline points="${pts("atl", y1)}" fill="none" stroke="var(--ink-3)" stroke-width="1.6" stroke-dasharray="4 3" stroke-linejoin="round"/>
      <text x="${l}" y="${t2 - 8}" style="fill:var(--ink-3);letter-spacing:.08em">FORM</text>
      ${grid(fticks, y2)}
      <defs><clipPath id="${cid}"><path d="M${x(0)},${z0} L${pts("form", y2).replace(/ /g, " L")} L${x(n - 1)},${z0} Z"/></clipPath></defs>
      <g clip-path="url(#${cid})">${bands}</g>
      <line x1="${l}" x2="${w - rr}" y1="${z0}" y2="${z0}" stroke="var(--ink-3)" stroke-dasharray="4 4"/>
      <g stroke-width="2" stroke-linecap="round">${formLine}</g>
      ${axisLabels(labels, x, bt - 4)}${GUIDE}</svg>
      <details class="def"><summary>What the colours mean</summary><ul>${FORM_ZONES.map(z => `<li><span><i style="background:${z.color}"></i><b>${z.label}</b> <em class="num">${z.range}</em></span><p>${z.text}</p></li>`).join("")}</ul></details>
      <p class="note">Built from Garmin's training load per workout, used the way TSS is. Fitness is the 6-week average, fatigue the 7-day average, form the gap between them going into the day.</p></section>`;
  }
  if (ch === "volume") {
    const daily = r === "1w", weeks = daily ? [...Array(7)].map((_, i) => isoAdd(today, i - 6)) : [...Array(WK)].map((_, i) => mondayOf(isoAdd(today, -7 * (WK - 1 - i))));
    const data = weeks.map(wk => SPORTS.map(sp => G.activities.filter(a => a.date >= wk && a.date < isoAdd(wk, daily ? 1 : 7)).flatMap(parts).filter(p => sportOf(p).key === sp.key).reduce((s, p) => s + p.min, 0)));
    const max = Math.max(...data.map(r => r.reduce((a, b) => a + b, 0))) || 1;
    // hours sit on top of the bars only while they fit (8 or fewer); otherwise hover shows them
    const tots = data.map(r => r.reduce((a, b) => a + b, 0)), labels = weeks.map(wk => daily ? fmtDate(wk) : "Week of " + shortDate(wk));
    const rows = [["Total", tots.map(t => t ? hm(t) : "–"), ""], ...SPORTS.map((sp, j) => [sp.name, data.map(d => d[j] ? hm(d[j]) : "–"), "", sp.color])];
    body = `<section class="card" data-pcard="volume"><div class="thead"><div class="eyebrow">${daily ? "Daily" : "Weekly"} volume by sport · hours trained</div>${seg(r)}</div><div class="vbars ${weeks.length > 20 ? "dense" : weeks.length > 8 ? "n12" : ""}" ${hoverAttr(labels, rows, 0, 1, { bars: true, mins: data })}>${weeks.map((wk, i) => { const tot = tots[i]; return `<div class="vcol"><span class="vt num">${!tot || weeks.length > 12 ? "" : weeks.length > 8 ? hmShort(tot) : hm(tot)}</span><div class="varea"><div class="vstack" style="height:${(tot / max * 100).toFixed(1)}%">${SPORTS.map((sp, j) => data[i][j] ? `<div style="flex:${data[i][j]};background:${sp.color}"></div>` : "").join("")}</div></div><span class="vl num">${weeks.length > 12 && i % Math.ceil(weeks.length / 8) ? "" : daily ? dow(wk) : shortDate(wk)}</span></div>`; }).join("")}</div><div class="legend">${SPORTS.map(sp => `<span><i style="background:${sp.color}"></i>${sp.name}</span>`).join("")}</div></section>`;
  }
  if (ch === "bests") {
    const vo2 = { run: T.vo2Run, bike: T.vo2Bike }[r], recs = G.records.filter(x => x.sport === r);
    const fmtRec = x => x.kind === "time" ? fmtTime(x.value) : x.kind === "km" ? (x.value / 1000).toFixed(1) + " km" : x.kind === "m" ? Math.round(x.value) + " m" : Math.round(x.value) + " W";
    const tabs = `<div class="seg" role="group" aria-label="Sport">${SPORTS.slice(0, 3).map(sp => `<button type="button" data-psport="${sp.key}" class="${sp.key === r ? "on" : ""}">${sp.name}</button>`).join("")}</div>`;
    // VO2 max on its own panel (with its 12-week change), then the records as tiles
    const key = { run: "vo2", bike: "vo2Bike" }[r], then = key && ALL[ALL.length - 85]?.[key], dv = vo2 && then ? vo2 - then : null;
    const vo2Box = vo2 ? `<div class="vo2box"><div><div class="eyebrow">VO2 max</div><div class="vbig num">${vo2.toFixed(1)}</div></div><div class="vnote">${dv == null ? "" : `<b class="num">${dv >= 0 ? "+" : ""}${dv.toFixed(1)}</b> in 12 weeks<br>`}Garmin's latest ${r === "bike" ? "cycling" : "running"} estimate</div></div>` : "";
    const curve = r === "bike" ? powerCurve(today) : "";
    const when = x => x.date ? new Date(x.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
    body = `<section class="card bests" data-pcard="bests"><div class="thead"><div class="eyebrow">Bests</div>${tabs}</div>${vo2Box}${curve}<div class="eyebrow prhead">Personal records · all time</div>${recs.length ? `<div class="prgrid">${recs.map(x => `<div class="prtile"><span class="pl">${x.label}</span><b class="num">${fmtRec(x)}</b><span class="pd num">${when(x)}</span></div>`).join("")}</div>` : `<p class="empty">No records yet.</p>`}</section>`;
  }
  return body;
}
// Garmin's power curve: the best average power held for each duration, last 12 weeks against all time.
// Durations sit evenly spaced (1 s to 30 min, near-log steps) and watts on a log scale, so a 1000 W sprint
// doesn't flatten the long efforts. FTP is estimated as 95% of the best 20 minutes.
function powerCurve(today) {
  const SECS = ["1 s", "2 s", "5 s", "10 s", "20 s", "30 s", "1 min", "2 min", "5 min", "10 min", "20 min", "30 min"];
  const rides = G.activities.filter(a => a.pc), cut = isoAdd(today, -83);
  const best = xs => SECS.map((_, k) => Math.max(0, ...xs.map(a => a.pc[k] || 0)) || null);
  const all = best(rides), now = best(rides.filter(a => a.date >= cut));
  if (!all.some(Boolean)) return "";
  const ftp = now[10] ? Math.round(now[10] * .95) : null;
  const w = 640, h = 190, l = 38, rr = 12, t = 10, b = 24, lo = 40, top = Math.max(...all) * 1.15;
  const x = k => l + k * (w - l - rr) / (SECS.length - 1), y = v => t + (1 - Math.log(Math.max(v, lo) / lo) / Math.log(top / lo)) * (h - t - b);
  const path = vs => smooth(vs.map((v, k) => v ? [x(k), y(v)] : null).filter(Boolean));
  const grid = [50, 100, 200, 500, 1000].filter(v => v < top).map(v => `<line x1="${l}" x2="${w - rr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${l - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join("");
  const ticks = [0, 2, 4, 6, 8, 9, 10, 11].map(k => `<text class="${[2, 9, 10].includes(k) ? "minor" : ""}" x="${x(k)}" y="${h - 6}" text-anchor="middle">${SECS[k].replace(" ", "")}</text>`).join("");
  const nowLine = now.some(Boolean) ? `<path d="${path(now)} L${x(11)} ${y(lo)} L${x(0)} ${y(lo)} Z" fill="var(--sp-bike)" opacity=".12"/><path d="${path(now)}" fill="none" stroke="var(--sp-bike)" stroke-width="2.5" stroke-linecap="round"/>` : "";
  const ftpLine = ftp ? `<line x1="${l}" x2="${w - rr}" y1="${y(ftp)}" y2="${y(ftp)}" stroke="var(--ink-3)" stroke-dasharray="4 4"/><text x="${l + 6}" y="${y(ftp) + 13}">FTP ${ftp} W</text>` : "";
  const svg = `<svg class="pcurve" viewBox="0 0 ${w} ${h}" width="100%" ${hoverAttr(SECS.map(s => "Best " + s), [["Last 12 weeks", now, "W"], ["All time", all, "W"]], x(0), x(11))}>${grid}${ticks}<path d="${path(all)}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="2 4"/>${nowLine}${ftpLine}${GUIDE}</svg>`;
  return `<div class="pcbox"><div class="pchead"><div><div class="eyebrow">Power curve</div><div class="pcftp"><b class="num">${ftp ?? "–"}</b> W <span>estimated FTP</span></div></div><div class="legend"><span><i style="background:var(--sp-bike)"></i>Last 12 weeks</span><span><i class="dash"></i>All time</span></div></div>${svg}<p class="note">Your best average power for each length of effort. FTP here is 95% of your best 20 minutes in the last 12 weeks.</p></div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-pcard] [data-range], [data-pcard] [data-psport]"); if (!b) return;
  const card = b.closest("[data-pcard]"); card.outerHTML = progressView(card.dataset.pcard, b.dataset.range || b.dataset.psport);
});

// The Progress tab, DBT's progress page in its order: verdict, tiles, endurance load, weekly volume,
// bests, wellness (last 7 days), next race. Each chart card carries its own switch.
function progressPage() {
  const FA = fitnessSeries(), now = FA[FA.length - 1], z = formZone(now.form), today = ALL[ALL.length - 1].date;
  const cut = isoAdd(today, -27), cut2 = isoAdd(today, -55), mins = (a, b) => G.activities.filter(x => x.date >= a && x.date < b).reduce((s, x) => s + x.min, 0);
  const m4 = mins(cut, "9999"), m4p = mins(cut2, cut), pct = m4p ? Math.round((m4 - m4p) / m4p * 100) : null;
  const month = G.activities.filter(a => a.date.slice(0, 7) === today.slice(0, 7)).length;
  const verdict = `<div class="pverdict"><b>You trained ${hm(m4)} in the last 4 weeks${pct == null ? "" : `, ${Math.abs(pct)}% ${pct >= 0 ? "more" : "less"} than the 4 weeks before`}.</b><span>Garmin rates your training ${T.status}.</span></div>`;
  const tile = (k, val, s = "") => `<div class="card"><div class="eyebrow">${k}</div><div class="v num">${val}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
  const tiles = `<div class="ptiles">${tile("Sessions this month", month)}${tile("Fitness", Math.round(now.ctl))}${tile("Form", (now.form > 0 ? "+" : "") + Math.round(now.form))}<div class="card"><div class="thead"><div class="eyebrow">What that means</div><span class="pill ${z.pill}">${z.label}</span></div><div class="s">${z.text}</div></div></div>`;
  const well = [["hrv", "Heart-rate variability", "ms", last.hrv], ["rhr", "Resting heart rate", "bpm", last.rhr], ["sleepH", "Sleep", "h", last.sleepH], ["bb", "Body battery", "high", last.bbHigh]]
    .map(([k, l, u, v]) => { const s = series(k, "1w"); return `<div class="card wtile"><div class="eyebrow">${l}</div><div class="v num">${v ?? "–"}<small>${u}</small></div>${lineChart(s.vals, { w: 200, h: 40, labels: s.labels, unit: u })}</div>`; }).join("");
  return `<div class="prog">${verdict}${tiles}${progressView("fitness")}${progressView("volume")}${progressView("bests")}
    <section class="card"><div class="eyebrow">Wellness · last 7 days</div><div class="wgrid">${well}</div></section>${seasonCard(SETTINGS.race)}</div>`;
}

// Tabs: swap the main view; each screen keeps its own state.
function wireTabs(root) {
  root.querySelectorAll(".screen").forEach(screen => {
    const main = screen.querySelector("main");
    const st = { tab: "home", day: ALL[ALL.length - 1].date };
    const render = () => {
      screen.querySelectorAll("[data-tab]").forEach(a => a.classList.toggle("on", a.dataset.tab === st.tab));
      const titles = { home: "Good morning", prog: "Progress", mem: "Memory", settings: "Settings" };
      screen.querySelector(".top h1").textContent = st.workout ? "Workout" : titles[st.tab];
      main.dataset.wid = st.workout || "";  // not data-workout: that name is the click target for opening a workout
      main.innerHTML = st.workout ? workoutPage(st.workout) : { home: homeMain, prog: progressPage, mem: memoryView, settings: settingsView }[st.tab]();
      if (st.workout) { wireCharts(main); if (!window.NOSCROLL) screen.scrollIntoView(); }
      else if (st.tab === "home") wirePops(main);
    };
    screen.addEventListener("click", e => {
      const t = e.target.closest("[data-tab],[data-workout],[data-back],[data-range]");
      if (!t || !screen.contains(t) || t.closest("dialog, .tile, [data-pcard]")) return;
      e.preventDefault();
      if (t.dataset.workout) { st.workout = t.dataset.workout; }
      else if ("back" in t.dataset) { st.workout = null; }
      else if (t.dataset.range) { st.range = t.dataset.range; }
      else if (t.dataset.tab) { st.tab = t.dataset.tab; st.workout = null; }
      render();
    });
  });
}
