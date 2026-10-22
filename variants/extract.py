"""Build variants/data.js (a year of daily numbers, workouts, records) and variants/workouts.js
(full detail for workouts that have it) from data/, so the variants page shows real numbers."""

import json
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA = ROOT / "data"
HIST = DATA / "history"
load = lambda p: json.loads(p.read_text(encoding="utf-8"))
parts = lambda name: (lambda d: list(d.values()) if isinstance(d, dict) else d)(load(HIST / f"{name}.json"))  # 28-day blocks
flat = lambda name: [x for part in parts(name) for x in (part or [])]

# ---- a year of daily numbers from the range calls ----
days = {}
day = lambda d: days.setdefault(d, {"date": d})
for s in flat("sleep"):
    v = s.get("values") or {}
    d = day(s["calendarDate"])
    d["sleepScore"] = v.get("sleepScore")
    d["sleepH"] = round((v.get("totalSleepTimeInSeconds") or 0) / 3600, 1) or None
    d["stages"] = [round((v.get(k) or 0) / 60) for k in ("deepTime", "lightTime", "remTime", "awakeTime")]
for r in flat("rhr"):
    day(r["calendarDate"])["rhr"] = r.get("value") and round(r["value"])
for part in parts("hrv"):
    for h in (part or {}).get("hrvSummaries", []):
        d = day(h["calendarDate"])
        b = h.get("baseline") or {}
        d.update(hrv=h.get("lastNightAvg"), hrvWeek=h.get("weeklyAvg"), hrvLow=b.get("balancedLow"), hrvHigh=b.get("balancedUpper"))
for s in flat("stress"):
    day(s["calendarDate"])["stress"] = (s.get("values") or {}).get("overallStressLevel")
for b in flat("body_battery"):
    v = b.get("values") or {}
    day(b["calendarDate"]).update(bbHigh=v.get("highBodyBattery"), bbLow=v.get("lowBodyBattery"))
for s in flat("steps"):
    day(s["calendarDate"])["steps"] = s.get("totalSteps")
for m in flat("vo2"):
    for kind, key in (("generic", "vo2"), ("cycling", "vo2Bike")):
        v = m.get(kind)
        if v and v.get("calendarDate"):
            day(v["calendarDate"])[key] = v.get("vo2MaxPreciseValue")

# ---- the recent daily files win where they exist (Garmin's own load range lives only there) ----
for f in sorted(DATA.glob("20*.json")):
    d = load(f)
    t = d.get("training_status") or {}
    st = next(iter(((t.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {}).values()), {})
    ac = st.get("acuteTrainingLoadDTO") or {}
    if ac:
        day(d["date"]).update(garminLoad=ac.get("dailyTrainingLoadAcute"), loadLow=round(ac.get("minTrainingLoadChronic") or 0),
                              loadHigh=round(ac.get("maxTrainingLoadChronic") or 0), status=(st.get("trainingStatusFeedbackPhrase") or "").split("_")[0].title())

# end on the latest day Garmin has numbers for (today's row is empty until the watch syncs)
today = date.fromisoformat(max(d for d, v in days.items() if v.get("sleepScore") or v.get("rhr") or v.get("steps")))
dates = [(today - timedelta(days=i)).isoformat() for i in range(364, -1, -1)]
ALL = [days.get(d, {"date": d}) for d in dates]
for key in ("vo2", "vo2Bike", "hrvLow", "hrvHigh"):  # carry forward between Garmin's updates
    last = None
    for d in ALL:
        last = d.get(key) if d.get(key) is not None else last
        d[key] = last

# ---- workouts ----
raw = sorted({a["activityId"]: a for a in load(HIST / "activities.json") + load(DATA / "activities.json")}.values(),
             key=lambda a: a["startTimeLocal"], reverse=True)
acts, details = [], {}
# swims count swimming time, not the rests at the wall. Other sports keep total time: Garmin's moving
# time is 0 for indoor rides and far too low for tennis (9 of 50 min), so it is only trusted for swims.
SWIMS = ("lap_swimming", "open_water_swimming")
active = lambda a: (a.get("movingDuration") or a.get("duration") or 0) if (a.get("activityType") or {}).get("typeKey") in SWIMS else (a.get("duration") or 0)
PC_SECS = (1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800)
legs = load(DATA / "legs.json") if (DATA / "legs.json").exists() else {}  # multi-sport legs, from pull.py
for a in raw:
    w = DATA / "workouts" / f"{a['activityId']}.json"
    x = {
        "id": a["activityId"], "date": a["startTimeLocal"][:10], "start": a["startTimeLocal"][11:16],
        "name": a.get("activityName"), "type": (a.get("activityType") or {}).get("typeKey"),
        "km": round((a.get("distance") or 0) / 1000, 2), "min": round(active(a) / 60, 1),
        "hr": a.get("averageHR"), "maxHr": a.get("maxHR"), "load": round(a.get("activityTrainingLoad") or 0),
        "kcal": a.get("calories"), "climb": a.get("elevationGain"), "cad": a.get("averageRunningCadenceInStepsPerMinute"),
        "power": a.get("avgPower"), "speed": a.get("averageSpeed"), "te": a.get("aerobicTrainingEffect"),
        "teAn": a.get("anaerobicTrainingEffect"), "teLabel": a.get("trainingEffectLabel"),
    }
    # best average power over each duration (Garmin's power-curve numbers), for the ride power curve
    if a.get("avgPower") and not a.get("excludeFromPowerCurveReports"):
        x["pc"] = [a.get(f"maxAvgPower_{s}") for s in PC_SECS]
    if str(a["activityId"]) in legs:
        x["legs"] = legs[str(a["activityId"])]
    if w.exists():
        wd = load(w)
        bounds = [z["zoneLowBoundary"] for z in wd["zones"]]
        x["zoneMins"] = [round(z["secsInZone"] / 60, 1) for z in wd["zones"]]
        x["zoneLow"] = bounds
        st = []
        for t, hr in wd["hr"]:
            z = sum(1 for b in bounds if hr >= b)
            if st and st[-1][0] == z:
                st[-1][2] = t
            else:
                if st:
                    st[-1][2] = t
                st.append([z, t, t])
        x["stretches"] = [s for s in st if s[2] > s[1]]
        if "series" in wd:
            x["detail"] = True
            details[a["activityId"]] = {"series": wd["series"], "laps": wd.get("laps", [])}
    acts.append(x)

# ---- Garmin's current status block (latest daily file) ----
# newest daily file whose status block is complete (Garmin fills today's in only after the first sync)
complete = lambda d: all(((d.get("training_status") or {}).get(k) or {}) for k in ("mostRecentTrainingStatus", "mostRecentTrainingLoadBalance", "mostRecentVO2Max")) \
    and ((d["training_status"]["mostRecentTrainingStatus"] or {}).get("latestTrainingStatusData"))
last = next(d for d in (load(f) for f in sorted(DATA.glob("20*.json"), reverse=True)) if complete(d))
ts = last["training_status"]
status = next(iter(ts["mostRecentTrainingStatus"]["latestTrainingStatusData"].values()))
bal = next(iter(ts["mostRecentTrainingLoadBalance"]["metricsTrainingLoadBalanceDTOMap"].values()))
acute = status["acuteTrainingLoadDTO"]
training = {
    "status": status["trainingStatusFeedbackPhrase"].split("_")[0].title(),
    "vo2Run": ts["mostRecentVO2Max"]["generic"]["vo2MaxPreciseValue"],
    "vo2Bike": ts["mostRecentVO2Max"]["cycling"]["vo2MaxPreciseValue"],
    "acuteLoad": acute["dailyTrainingLoadAcute"], "chronicLow": round(acute["minTrainingLoadChronic"]),
    "chronicHigh": round(acute["maxTrainingLoadChronic"]), "ratio": acute["dailyAcuteChronicWorkloadRatio"],
    "balance": bal["trainingBalanceFeedbackPhrase"],
    "focus": [
        ["Anaerobic", round(bal["monthlyLoadAnaerobic"]), bal["monthlyLoadAnaerobicTargetMin"], bal["monthlyLoadAnaerobicTargetMax"]],
        ["High aerobic", round(bal["monthlyLoadAerobicHigh"]), bal["monthlyLoadAerobicHighTargetMin"], bal["monthlyLoadAerobicHighTargetMax"]],
        ["Low aerobic", round(bal["monthlyLoadAerobicLow"]), bal["monthlyLoadAerobicLowTargetMin"], bal["monthlyLoadAerobicLowTargetMax"]],
    ],
}

# Garmin's personal-record type ids, grouped by sport for the Bests switch on the Progress tab
PR = {1: ("Fastest 1 km", "time", "run"), 2: ("Fastest mile", "time", "run"), 3: ("Fastest 5 km", "time", "run"), 4: ("Fastest 10 km", "time", "run"),
      5: ("Fastest half marathon", "time", "run"), 6: ("Fastest marathon", "time", "run"), 7: ("Longest run", "km", "run"),
      8: ("Longest ride", "km", "bike"), 9: ("Most climbing in a ride", "m", "bike"), 10: ("Best 20-min power", "W", "bike"), 11: ("Fastest 40 km ride", "time", "bike"),
      17: ("Longest swim", "km", "swim"), 18: ("Fastest 100 m", "time", "swim"), 20: ("Fastest 400 m", "time", "swim"), 22: ("Fastest 750 m", "time", "swim"),
      23: ("Fastest 1000 m", "time", "swim"), 25: ("Fastest 1500 m", "time", "swim")}
records = [{"label": PR[r["typeId"]][0], "kind": PR[r["typeId"]][1], "sport": PR[r["typeId"]][2], "value": r["value"],
            "date": (r.get("activityStartDateTimeLocalFormatted") or r.get("prStartTimeGmtFormatted") or "")[:10]}
           for r in load(DATA / "records.json") if r["typeId"] in PR]

# ---- the weekly plan (coach/plan-prompt.md writes data/plan/<monday>.json) and Claude's memory ----
monday = (today - timedelta(days=today.weekday())).isoformat()
plans = sorted((load(p) for p in (DATA / "plan").glob("*.json")), key=lambda p: p["week"]) if (DATA / "plan").exists() else []
plans = [p for p in plans if p["week"] >= monday]
plan = {**plans[-1], "sessions": [s for p in plans for s in p["sessions"]]} if plans else None
memory = (ROOT / "memory.md").read_text(encoding="utf-8") if (ROOT / "memory.md").exists() else ""

out = Path(__file__).parent
built = datetime.now().isoformat(timespec="minutes")  # shown on the page, so a stale copy says so
(out / "data.js").write_text("window.G = " + json.dumps({"days": ALL, "training": training, "activities": acts, "records": records, "built": built}) + ";\n"
                             + "window.PLAN = " + json.dumps(plan) + ";\nwindow.MEMORY = " + json.dumps(memory) + ";\n", encoding="utf-8")
# the published page: same file minus the document skeleton the artifact host adds itself
page = (out / "index.html").read_text(encoding="utf-8")
for tag in ("<!doctype html>", '<html lang="en">', "<head>", '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">', "</head>", "<body>", "</body>", "</html>"):
    page = page.replace(tag + "\n", "", 1)
(out / "pulse.html").write_text(page, encoding="utf-8")
(out / "workouts.js").write_text("window.W = " + json.dumps(details) + ";\n", encoding="utf-8")
print(len(ALL), "days,", len(acts), "workouts,", len(details), "with full detail")
