// Settings: home card order (move, hide, add), theme, race, weekly plan on/off, plus the
// coach's small memory of dismissed notes and approved plans. One object, saved in one place.
const DEFAULT_SETTINGS = { cards: ["season", "hrv", "sleep", "rhr", "bb", "vo2", "training", "week"], theme: "dark", race: null, planOn: false, dismissed: {}, approved: {} };
let SETTINGS = { ...DEFAULT_SETTINGS };

// Saved choices live in the dashboard's store (db doc settings/main), which the morning task reads
// to see the race, the plan switch and approvals. This browser keeps a copy so the page opens instantly.
const STORE_KEY = "pulse-settings";
let SETTINGS_DOC = null;
function loadSettings(onRemote) {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { s = null; }
  SETTINGS = { ...DEFAULT_SETTINGS, ...(s || {}) };
  // the store answers later (or never, opened as a plain file); when it does, its copy wins
  window.claude?.use?.("db").then(async db => {
    if (!db) return;
    SETTINGS_DOC = db.doc("settings/main");
    const snap = await SETTINGS_DOC.get();
    if (snap.exists) { SETTINGS = { ...DEFAULT_SETTINGS, ...snap.data() }; try { localStorage.setItem(STORE_KEY, JSON.stringify(SETTINGS)); } catch (e) {} onRemote?.(); }
    else SETTINGS_DOC.set(SETTINGS).catch(() => {});
  }).catch(() => {});
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(SETTINGS)); } catch (e) { /* private window: keep it for this visit only */ }
  SETTINGS_DOC?.set(SETTINGS).catch(() => { /* read-only viewer or offline: the local copy still holds it */ });
}

function settingsView() {
  const on = SETTINGS.cards, off = Object.keys(CARDS).filter(k => !on.includes(k)), r = SETTINGS.race || {};
  const row = (k, i) => `<li><span>${CARDS[k]}</span><span class="sbtns"><button class="icon" data-move="${k}" data-by="-1" ${i ? "" : "disabled"} aria-label="Move ${CARDS[k]} up">↑</button><button class="icon" data-move="${k}" data-by="1" ${i < on.length - 1 ? "" : "disabled"} aria-label="Move ${CARDS[k]} down">↓</button><button class="icon" data-hide="${k}" aria-label="Remove ${CARDS[k]}">×</button></span></li>`;
  const sports = ["Run", "Ride", "Swim", "Triathlon", "Duathlon", "Other"];
  return `<section class="card set"><div class="eyebrow">Home cards</div><p class="note">The coach note always comes first. Move the rest, or remove what you don't look at.</p><ol class="cardlist">${on.map(row).join("")}</ol>
      ${off.length ? `<div class="k">Add a card</div><div class="addrow">${off.map(k => `<button class="btn" data-add="${k}">+ ${CARDS[k]}</button>`).join("")}</div>` : ""}</section>
    <section class="card set"><div class="eyebrow">Race</div><p class="note">Set a race and plans build to it: base, build, peak, taper. Leave it empty to train for general health.</p>
      <div class="form"><label>Name<input data-race="name" value="${(r.name || "").replace(/"/g, "&quot;")}" placeholder="Dubai Marathon"></label><label>Date<input type="date" data-race="date" value="${r.date || ""}"></label>
      <label>Type<select data-race="type">${sports.map(s => `<option ${r.type === s ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>
      ${SETTINGS.race ? `<button class="btn" data-clearrace>Remove race</button>` : ""}</section>
    <section class="card set"><div class="eyebrow">Weekly plan</div><label class="toggle"><input type="checkbox" data-planon ${SETTINGS.planOn ? "checked" : ""}><span><b>Write my week</b><br><small>Claude writes next week every Sunday morning. Nothing goes to your watch until you approve it.</small></span></label></section>
    <section class="card set"><div class="eyebrow">Look</div><div class="seg">${["dark", "light"].map(t => `<button type="button" data-theme="${t}" class="${SETTINGS.theme === t ? "on" : ""}">${t === "dark" ? "Dark" : "Light"}</button>`).join("")}</div></section>`;
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-move],[data-hide],[data-add],[data-theme],[data-clearrace]"); if (!b) return;
  const c = SETTINGS.cards = [...SETTINGS.cards];
  if (b.dataset.move) { const i = c.indexOf(b.dataset.move), j = i + +b.dataset.by; [c[i], c[j]] = [c[j], c[i]]; }
  else if (b.dataset.hide) c.splice(c.indexOf(b.dataset.hide), 1);
  else if (b.dataset.add) c.push(b.dataset.add);
  else if (b.dataset.theme) { SETTINGS.theme = b.dataset.theme; applyTheme(); }
  else if ("clearrace" in b.dataset) SETTINGS.race = null;
  saveSettings();
  b.closest("main").innerHTML = settingsView();
});
document.addEventListener("change", e => {
  const f = e.target;
  if (f.dataset.race) {
    SETTINGS.race = { type: "Run", ...(SETTINGS.race || {}), [f.dataset.race]: f.value };
    if (!SETTINGS.race.date && !SETTINGS.race.name) SETTINGS.race = null;
  } else if ("planon" in f.dataset) SETTINGS.planOn = f.checked;
  else return;
  saveSettings();
});
function applyTheme() { document.body.className = `t-${SETTINGS.theme}`; }
