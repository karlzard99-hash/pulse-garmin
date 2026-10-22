# How Claude writes next week's plan

Run on Sunday morning by the morning task when the plan toggle is on, or whenever the user asks for a plan.

## 1. Read
- `coach/rules.md` — the rules. Every one must hold, unless `memory.md` records the user's override.
- `memory.md` — goal, race, preferences, overrides, what worked.
- `variants/data.js` (`window.G`) — the last 4 weeks of workouts (sport, minutes, load, legs),
  HRV against its normal range, sleep score, resting HR, body battery, Garmin's training status.
- The race and plan toggle saved in the dashboard (the morning task reads them from the artifact store).
- Last week's plan in `data/plan/`, if any: what was done, what was missed.

## 2. Decide
- The race phase from the race date (Base > 16 weeks out, Build 16–7, Peak 6–3, Taper 2–1, Race week, Recovery after).
  No race: general health.
- Last 4 weeks' total time per week. Next week's total is at most +10% on the highest of them, or about −30% if the last
  3 weeks rose in a row.
- Recovery signals right now (HRV low 2+ nights, sleep, resting HR, body battery). If they are poor, the first hard session moves
  later in the week or becomes easy.
- The intensity mix from the goal (rules.md, "Intensity").

## 3. Write `data/plan/<monday>.json`
```json
{
  "week": "2026-10-26",
  "status": "draft",
  "title": "Easy week to let HRV recover",
  "why": "One or two plain sentences: what the week is for, in the user's words.",
  "sessions": [
    {
      "date": "2026-10-27", "title": "Easy run", "type": "running", "min": 40, "why": "Short reason.",
      "steps": [
        { "type": "warmup", "min": 10, "zone": 2, "text": "10 min easy, zone 2" },
        { "type": "repeat", "reps": 4, "text": "4 × (3 min zone 4, 2 min easy)", "steps": [
          { "type": "interval", "min": 3, "zone": 4, "text": "3 min zone 4" },
          { "type": "recovery", "min": 2, "zone": 1, "text": "2 min easy" } ] },
        { "type": "cooldown", "min": 10, "zone": 1, "text": "10 min easy" }
      ]
    },
    {
      "date": "2026-10-31", "title": "Brick: ride then run", "type": "multi_sport", "min": 90,
      "legs": [ { "type": "indoor_cycling", "min": 70, "steps": [ ... ] }, { "type": "running", "min": 20, "steps": [ ... ] } ]
    }
  ]
}
```
- `type` uses Garmin's keys: `running`, `treadmill_running`, `cycling`, `indoor_cycling`, `lap_swimming`, `open_water_swimming`,
  `strength_training`, `walking`, `multi_sport`.
- Steps are time-based (`min`) or distance-based (`km`) with a heart rate `zone` 1–5. `text` is what the dashboard shows.
- A multi-sport session has `legs`, each with its own `type`, `min` and `steps`; `min` on the session is the total.
- Strength and mobility sessions use one step with `text` describing the exercises.
- Rest days are simply days with no session.

## 4. Check, then publish
- Re-read rules.md and tick each rule against the plan. Fix and re-check if one fails.
- Run `variants/extract.py` so the dashboard shows it, then republish the dashboard.
- Status stays `draft` until the user approves it in the chat (the week shows on the Home week card). Only `send_plan.py` changes it to `sent`.
