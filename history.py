r"""Pull long-range daily numbers (sleep, HRV, resting HR, stress, body battery, steps, VO2 max)
plus the workout list, using Garmin's range calls, so a year costs a few dozen calls, not thousands.

Usage:  .venv\Scripts\python.exe history.py [days]      refresh the blocks covering the last N days (default 365)
        .venv\Scripts\python.exe history.py --backfill  add the next older blocks, up to 2 years back

Days are fetched in fixed 28-day blocks, saved under their dates in data/history/<name>.json, so a
refresh only replaces the blocks it fetched and the backfill grows the history a few blocks a day.
"""

import json
import sys
import time
from datetime import date, timedelta

from pull import DATA, connect

HISTORY = DATA / "history"
CHUNK = 28  # days per call for the endpoints that cap a request
ORIGIN = date(2000, 1, 3)  # blocks start on this grid, so the same block always has the same key
KEEP_DAYS = 730  # the backfill stops at two years
BACKFILL_BLOCKS = 4  # blocks added per morning, about 30 calls


def block_start(d: date) -> date:
    return d - timedelta(days=(d - ORIGIN).days % CHUNK)


def blocks(start: date, end: date):
    s = block_start(start)
    while s <= end:
        yield s.isoformat(), min(end, s + timedelta(days=CHUNK - 1)).isoformat()
        s += timedelta(days=CHUNK)


def load(name: str) -> dict:
    path = HISTORY / f"{name}.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return data if isinstance(data, dict) else {}  # an old list-shaped file is simply refetched


def fetch(api, start: date, end: date) -> None:
    calls = {
        "sleep": api.get_sleep_daily, "rhr": api.get_rhr_daily, "hrv": api.get_hrv_data_range,
        "stress": api.get_daily_stress_stats, "body_battery": api.get_daily_body_battery_stats,
        "steps": api.get_daily_steps, "vo2": api.get_max_metrics_range,
    }
    for name, call in calls.items():
        saved = load(name)
        for a, b in blocks(start, end):
            try:
                saved[a] = call(a, b)
            except Exception as e:
                print(f"{name} {a}..{b} failed: {e}")
            time.sleep(0.5)
        (HISTORY / f"{name}.json").write_text(json.dumps(saved), encoding="utf-8")
        print(f"saved {name}: {len(saved)} blocks")

    path = HISTORY / "activities.json"
    acts = {a["activityId"]: a for a in (json.loads(path.read_text(encoding="utf-8")) if path.exists() else [])}
    acts.update({a["activityId"]: a for a in api.get_activities_by_date(block_start(start).isoformat(), end.isoformat())})
    path.write_text(json.dumps(sorted(acts.values(), key=lambda a: a["startTimeLocal"], reverse=True)), encoding="utf-8")
    print(f"{len(acts)} activities on file")


def main() -> None:
    HISTORY.mkdir(parents=True, exist_ok=True)
    today = date.today()
    if sys.argv[1:2] == ["--backfill"]:
        have = sorted(load("sleep"))
        oldest = date.fromisoformat(have[0]) if have else block_start(today)
        limit = block_start(today - timedelta(days=KEEP_DAYS))
        if oldest <= limit:
            print("backfill complete: two years on file")
            return
        start = max(limit, oldest - timedelta(days=CHUNK * BACKFILL_BLOCKS))
        fetch(connect(), start, oldest - timedelta(days=1))
        return
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 365
    fetch(connect(), today - timedelta(days=days - 1), today)


if __name__ == "__main__":
    main()
