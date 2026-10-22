r"""Pull Garmin Connect data into data/ as JSON files.

Usage:  .venv\Scripts\python.exe pull.py [days]   (default 7)
First run signs in with GARMIN_EMAIL / GARMIN_PASSWORD from .env and asks
for an MFA code if Garmin wants one. After that, saved tokens are used.

Days already saved are skipped (except the last 2, which Garmin may still be
updating), and each new workout gets its heart rate zones and HR trace once.
A short pause between calls keeps a long backfill well inside Garmin's limits.
"""

import json
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
from garminconnect import Garmin

ROOT = Path(__file__).parent
DATA = ROOT / "data"
WORKOUTS = DATA / "workouts"
TOKENS = ROOT / ".garmin-tokens"
PAUSE = 1.0  # seconds between days

DAILY = {
    "summary": "get_user_summary",
    "sleep": "get_sleep_data",
    "hrv": "get_hrv_data",
    "stress": "get_stress_data",
    "heart_rate": "get_heart_rates",
    "training_status": "get_training_status",
}


def connect() -> Garmin:
    load_dotenv(ROOT / ".env")
    api = Garmin(
        os.getenv("GARMIN_EMAIL"),
        os.getenv("GARMIN_PASSWORD"),
        prompt_mfa=lambda: input("Garmin MFA code: ").strip(),
    )
    api.login(str(TOKENS))
    return api


def hr_trace(details: dict) -> list:
    """[seconds, bpm] pairs from an activity's detail metrics, one every ~15 s."""
    keys = [m["key"] for m in details.get("metricDescriptors", [])]
    if "directHeartRate" not in keys or "sumDuration" not in keys:
        return []
    hi, ti = keys.index("directHeartRate"), keys.index("sumDuration")
    out, last = [], -15
    for row in details.get("activityDetailMetrics", []):
        m = row.get("metrics") or []
        t, hr = m[ti] if ti < len(m) else None, m[hi] if hi < len(m) else None
        if t is None or hr is None or t - last < 15:
            continue
        out.append([round(t), round(hr)])
        last = t
    return out


SERIES = {"t": "sumDuration", "hr": "directHeartRate", "speed": "directSpeed", "ele": "directElevation",
          "cad": "directRunCadence", "power": "directPower", "dist": "sumDistance", "lat": "directLatitude", "lon": "directLongitude"}
DETAIL_DAYS = 30   # full workout detail kept this long
ON_DEMAND_DAYS = 14  # an older workout opened on request keeps its detail this long
LAP_KEYS = ["distance", "duration", "averageSpeed", "averageHR", "maxHR", "averageRunCadence", "elevationGain", "elevationLoss", "averagePower"]


def full_detail(api: Garmin, activity_id) -> dict:
    """Zones, HR trace and the Garmin-style detail: series (≤600 points per line) and laps."""
    details = api.get_activity_details(activity_id)
    keys = [m["key"] for m in details.get("metricDescriptors", [])]
    rows = [r.get("metrics") or [] for r in details.get("activityDetailMetrics", [])]
    step = max(1, len(rows) // 600)
    series = {}
    for name, key in SERIES.items():
        if key in keys:
            i = keys.index(key)
            series[name] = [(r[i] if i < len(r) else None) for r in rows[::step]]
    laps = api.get_activity_splits(activity_id).get("lapDTOs", [])
    return {
        "zones": api.get_activity_hr_in_timezones(activity_id),
        "hr": hr_trace(details),
        "series": series,
        "laps": [{k: lap.get(k) for k in LAP_KEYS} for lap in laps],
    }


def save_workout(api: Garmin, a: dict, keep_until: str | None = None) -> None:
    out = full_detail(api, a["activityId"])
    if keep_until:
        out["keepUntil"] = keep_until
    (WORKOUTS / f"{a['activityId']}.json").write_text(json.dumps(out), encoding="utf-8")
    print(f"saved detail for {a['startTimeLocal'][:10]} {a.get('activityName')}")


def prune(today: date) -> None:
    """Drop the heavy detail of workouts older than DETAIL_DAYS, unless opened on request recently."""
    cutoff = (today - timedelta(days=DETAIL_DAYS)).isoformat()
    dates = {str(a["activityId"]): a["startTimeLocal"][:10]
             for a in json.loads((DATA / "activities.json").read_text(encoding="utf-8"))}
    for f in WORKOUTS.glob("*.json"):
        d = json.loads(f.read_text(encoding="utf-8"))
        if "series" in d and dates.get(f.stem, "9999") < cutoff and d.get("keepUntil", "") < today.isoformat():
            d.pop("series"); d.pop("laps", None); d.pop("keepUntil", None)
            f.write_text(json.dumps(d), encoding="utf-8")


def save_legs(api: Garmin) -> None:
    """Each multi-sport activity (brick, triathlon) once: its legs in order, kept in data/legs.json."""
    path = DATA / "legs.json"
    have = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    acts = [a for f in (DATA / "activities.json", DATA / "history" / "activities.json") if f.exists()
            for a in json.loads(f.read_text(encoding="utf-8"))]
    for a in acts:
        if (a.get("activityType") or {}).get("typeKey") != "multi_sport" or str(a["activityId"]) in have:
            continue
        legs = []
        for cid in (api.get_activity(a["activityId"]).get("metadataDTO") or {}).get("childIds", []):
            c = api.get_activity(cid)
            s = c.get("summaryDTO") or {}
            legs.append({"type": (c.get("activityTypeDTO") or {}).get("typeKey"), "start": (s.get("startTimeLocal") or "")[11:16],
                         "min": round((s.get("duration") or 0) / 60, 1), "km": round((s.get("distance") or 0) / 1000, 2),
                         "hr": s.get("averageHR") and round(s["averageHR"])})
            time.sleep(PAUSE)
        have[str(a["activityId"])] = legs
        print(f"saved {len(legs)} legs for {a['startTimeLocal'][:10]} {a.get('activityName')}")
    path.write_text(json.dumps(have, indent=2), encoding="utf-8")


def main() -> None:
    if len(sys.argv) > 2 and sys.argv[1] == "--workout":
        # On request: full detail for one older workout, kept ON_DEMAND_DAYS
        api = connect()
        a = next(x for x in json.loads((DATA / "history" / "activities.json").read_text(encoding="utf-8"))
                 if str(x["activityId"]) == sys.argv[2])
        save_workout(api, a, (date.today() + timedelta(days=ON_DEMAND_DAYS)).isoformat())
        return
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    api = connect()
    WORKOUTS.mkdir(parents=True, exist_ok=True)
    today = date.today()

    for i in range(days):
        day = (today - timedelta(days=i)).isoformat()
        path = DATA / f"{day}.json"
        if i >= 2 and path.exists():
            continue
        out = {"date": day}
        for key, method in DAILY.items():
            try:
                out[key] = getattr(api, method)(day)
            except Exception as e:  # one missing metric shouldn't stop the rest
                out[key] = {"error": str(e)}
        path.write_text(json.dumps(out, indent=2), encoding="utf-8")
        print(f"saved {day}")
        time.sleep(PAUSE)

    start = (today - timedelta(days=days - 1)).isoformat()
    acts = api.get_activities_by_date(start, today.isoformat())
    known = {a["activityId"]: a for a in json.loads((DATA / "activities.json").read_text(encoding="utf-8"))} \
        if (DATA / "activities.json").exists() else {}
    known.update({a["activityId"]: a for a in acts})
    (DATA / "activities.json").write_text(
        json.dumps(sorted(known.values(), key=lambda a: a["startTimeLocal"], reverse=True), indent=2), encoding="utf-8")
    print(f"{len(known)} activities on file")

    cutoff = (today - timedelta(days=DETAIL_DAYS)).isoformat()
    for a in acts:
        path = WORKOUTS / f"{a['activityId']}.json"
        recent = a["startTimeLocal"][:10] >= cutoff
        have = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        if have and ("series" in have or not recent):
            continue
        try:
            if recent:
                save_workout(api, a)
            else:  # older than the detail window: zones and HR trace only
                d = api.get_activity_details(a["activityId"])
                path.write_text(json.dumps({"zones": api.get_activity_hr_in_timezones(a["activityId"]), "hr": hr_trace(d)}), encoding="utf-8")
        except Exception as e:
            print(f"skipped detail for {a['activityId']}: {e}")
        time.sleep(PAUSE)
    prune(today)
    try:
        save_legs(api)
    except Exception as e:
        print(f"skipped multi-sport legs: {e}")

    try:
        (DATA / "records.json").write_text(json.dumps(api.get_personal_record(), indent=2), encoding="utf-8")
    except Exception as e:
        print(f"skipped personal records: {e}")


if __name__ == "__main__":
    main()
