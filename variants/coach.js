// The coach: detectors that pick today's note, the Plan tab and the Memory tab.
// Every note says what was noticed, what to do, and what it gets you.
const today_ = () => ALL[ALL.length - 1].date;
const planSessions = () => window.PLAN?.sessions || [];
const weekLoads = n => [...Array(n)].map((_, k) => { const mon = isoAdd(mondayOf(today_()), -7 * (n - k));
  return G.activities.filter(a => a.date >= mon && a.date < isoAdd(mon, 7)).reduce((s, a) => s + a.load, 0); });

const DETECTORS = [
  function hrvLow() {
    let n = 0; for (let i = ALL.length - 1; i >= 0 && ALL[i].hrv != null && ALL[i].hrv < ALL[i].hrvLow; i--) n++;
    if (n < 2) return null;
    return { key: "hrv", score: 80 + n, title: "Keep this week easy",
      noticed: `HRV has been under your normal range (${last.hrvLow}–${last.hrvHigh}) for ${n} nights in a row, and Garmin rates your training ${T.status}.`,
      todo: `No hard sessions until HRV is back above ${last.hrvLow}. Easy runs, swims and rides are fine.`,
      gets: "Your body catches up, so the next hard week builds fitness instead of digging deeper." };
  },
  function roughMorning() {
    // rules.md, "Recovery signals": sleep under 60, resting HR 5+ above normal, body battery under 25
    const rhrNorm = avg(ALL.slice(-29, -1).map(d => d.rhr));
    const bad = [last.sleepScore != null && last.sleepScore < 60 && `sleep scored ${last.sleepScore}`,
      last.rhr != null && rhrNorm && last.rhr >= rhrNorm + 5 && `resting heart rate is ${last.rhr}, ${Math.round(last.rhr - rhrNorm)} above normal`,
      last.bbHigh != null && last.bbHigh < 25 && `body battery only charged to ${last.bbHigh}`].filter(Boolean);
    if (!bad.length) return null;
    return { key: "rough", score: 75, title: "Rough night: go easy today",
      noticed: `Last night ${bad.join(" and ")}.`, todo: "Swap anything hard today for an easy session or rest. Keep it under an hour.",
      gets: "A hard session on a flat battery costs more than it builds. Tomorrow's will count for more." };
  },
  function missed() {
    const y = isoAdd(today_(), -1), miss = planSessions().filter(p => p.date === y && !G.activities.some(a => a.date === y));
    if (!miss.length) return null;
    return { key: "missed", score: 60, title: "Yesterday's session didn't happen",
      noticed: `${miss.map(p => p.title).join(" and ")} was planned for yesterday and nothing was recorded.`,
      todo: "Don't squeeze it in on top of today. Skip it, or swap it for one of this week's easy days.",
      gets: "The week stays balanced instead of stacking two hard days." };
  },
  function hardTomorrow() {
    const tm = isoAdd(today_(), 1), p = planSessions().filter(s => s.date === tm), mins = p.reduce((s, x) => s + x.min, 0);
    const avgDay = G.activities.filter(a => a.date >= isoAdd(today_(), -27)).reduce((s, a) => s + a.min, 0) / 28;
    if (!mins || mins < 1.5 * avgDay || mins < 60) return null;
    return { key: "tomorrow", score: 50, title: "Big day tomorrow",
      noticed: `Tomorrow is ${p.map(x => x.title).join(" + ")}, ${hm(mins)}. Your usual day is ${hm(avgDay)}.`,
      todo: "Keep today easy, eat well tonight and get to bed early.", gets: "You start tomorrow fresh enough to do it properly." };
  },
  function recoveryWeek() {
    const [a, b, c] = weekLoads(3);
    if (!(a > 0 && b > a * 1.05 && c > b * 1.05)) return null;
    return { key: "recweek", score: 65, title: "Make next week an easy one",
      noticed: `Your load has gone up three weeks in a row: ${a}, ${b}, ${c}.`,
      todo: "Next week, cut time by about a third and keep everything easy.", gets: "The fitness from those three weeks settles in, and you start the next block stronger." };
  },
  function retest() {
    const t = G.activities.find(a => /test|ftp|time trial|tt\b/i.test(a.name || ""));
    if (t && t.date >= isoAdd(today_(), -56)) return null;
    return { key: "retest", score: 20, title: "Time for a fitness check",
      noticed: t ? `Your last test was ${shortDate(t.date)}, more than 8 weeks ago.` : "There's no fitness test in your history yet.",
      todo: "On a fresh day, do a 20-minute all-out run or ride. Name it \"Test\" so it gets picked up.",
      gets: "Your zones and plans match the fitness you have now, not the fitness you had." };
  },
  function race() {
    const p = racePhase(SETTINGS.race); if (!p) return null;
    const nm = SETTINGS.race.name || "your race";
    if (p.days < 0) return { key: "debrief", score: 85, title: `How did ${nm} go?`, noticed: `${nm} was ${-p.days} days ago.`,
      todo: "Tell Claude how it went: what worked, what didn't. Keep training easy for two weeks.", gets: "The next plan learns from this race, and your body gets the rest it earned." };
    if (p.phase === "Race week") return { key: "raceweek", score: 90, title: "Race week", noticed: `${nm} is ${p.days === 0 ? "today" : `in ${p.days} days`}.`,
      todo: "Short sessions with a few race-pace efforts. Nothing new: same food, same kit, early nights.", gets: "You arrive fresh and sharp, not tired and not rusty." };
    if (p.phase === "Taper") return { key: "taper", score: 75, title: "Taper starts now", noticed: `${nm} is ${p.weeks} weeks away.`,
      todo: "Cut total time by 30–40%, keep a little intensity in each session.", gets: "Fatigue drops faster than fitness, so you race at your best." };
    return null;
  },
];

function notes() {
  const done = SETTINGS.dismissed || {};
  return DETECTORS.map(f => f()).filter(n => n && done[n.key] !== today_()).sort((a, b) => b.score - a.score);
}
const ALL_NORMAL = { key: "normal", title: "All normal today", noticed: "Sleep, HRV and resting heart rate are inside your usual ranges.", todo: "Train as planned.", gets: "Steady weeks like this are where fitness comes from." };

function coachCard() {
  const ns = notes(), n = ns[0] || ALL_NORMAL, more = ns.slice(1);
  // compact: the title and what to do show; why it matters and any other notes sit behind one tap
  const why = x => `<p><b>Noticed</b> ${x.noticed}</p><p><b>Gets you</b> ${x.gets}</p>`;
  const extra = more.length ? ` · ${more.length} more` : "";
  return `<section class="pro" data-note="${n.key}"><div class="phead"><span class="eyebrow">Coach note</span>${n.key === "normal" ? "" : `<span class="acts"><button class="btn sm" data-talk>Talk about it</button><button class="btn sm primary" data-dismiss="${n.key}">Got it</button></span>`}</div>
    <h2>${n.title}</h2><p class="pdo">${n.todo}</p>
    <details class="pwhy"><summary>Why${extra}</summary>${why(n)}${more.map(m => `<div class="mnote"><b>${m.title}</b><p>${m.todo}</p>${why(m)}</div>`).join("")}</details></section>`;
}
document.addEventListener("click", e => {
  const d = e.target.closest("[data-dismiss]"), t = e.target.closest("[data-talk]");
  if (d) { SETTINGS.dismissed = { ...(SETTINGS.dismissed || {}), [d.dataset.dismiss]: today_() }; saveSettings(); d.closest(".pro").outerHTML = coachCard(); }
  // "Talk about it" opens the dashboard's comment box on this card; Claude reads comments in the chat
  if (t) window.claude?.use?.("comments").then(c => c ? c.openComposer({ element: t.closest(".pro, .plan") }) : (t.textContent = "Comment on this card: Claude reads it")).catch(() => (t.textContent = "Comment on this card: Claude reads it"));
});

// ---- Memory tab: memory.md as written by Claude, shown as plain text with headings and lists ----
function mdToHTML(md) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  let out = "", list = false;
  md.split(/\r?\n/).forEach(l => {
    const li = l.match(/^\s*[-*] (.*)/);
    if (li && !list) { out += "<ul>"; list = true; } else if (!li && list) { out += "</ul>"; list = false; }
    if (li) out += `<li>${esc(li[1])}</li>`;
    else if (/^#{1,3} /.test(l)) out += `<h${l.indexOf(" ") + 2}>${esc(l.replace(/^#+ /, ""))}</h${l.indexOf(" ") + 2}>`;
    else if (l.trim()) out += `<p>${esc(l)}</p>`;
  });
  return out + (list ? "</ul>" : "");
}
function memoryView() {
  return window.MEMORY ? `<section class="card memory">${mdToHTML(window.MEMORY)}<p class="note">Claude keeps this file. Tell it something in the chat, or comment here, and it lands in the right section.</p></section>`
    : `<section class="card"><p class="empty">No memory yet. Tell Claude about your goals, injuries or what you like, and it shows up here.</p></section>`;
}
