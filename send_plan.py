r"""Send an approved weekly plan to Garmin Connect, so the sessions reach the watch on its next sync.

Usage:  .venv\Scripts\python.exe send_plan.py <monday> [--approved] [--dry]
Reads data/plan/<monday>.json. Only a plan whose status is "approved" is sent, or a "draft" when
--approved is passed (Claude does that once the user approves the week in the chat). Each session is uploaded as a Garmin workout
and scheduled on its date; a brick or other multi-sport session goes as one multi-sport workout.
Garmin ids are written back and the plan becomes "sent", so running it twice sends nothing twice.
Nothing on Garmin is ever deleted. --dry prints what would be sent and changes nothing.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent
PLANS = ROOT / "data" / "plan"

SPORT = {  # plan "type" -> Garmin workout sport (id, key)
    "running": (1, "running"), "treadmill_running": (1, "running"), "trail_running": (1, "running"), "walking": (1, "running"),
    "cycling": (2, "cycling"), "indoor_cycling": (2, "cycling"), "virtual_ride": (2, "cycling"), "road_biking": (2, "cycling"),
    "lap_swimming": (4, "swimming"), "open_water_swimming": (4, "swimming"),
    "strength_training": (5, "strength_training"), "multi_sport": (10, "multi_sport"),
}
STEP = {"warmup": (1, "warmup"), "cooldown": (2, "cooldown"), "interval": (3, "interval"), "recovery": (4, "recovery")}
key = lambda kind, i, k: {f"{kind}Id": i, f"{kind}Key": k, "displayOrder": i}


def sport(kind: str) -> dict:
    return key("sportType", *SPORT.get(kind, (3, "other")))


def step(s: dict, order: list) -> dict:
    order[0] += 1
    if s["type"] == "repeat":
        return {"type": "RepeatGroupDTO", "stepOrder": order[0], "stepType": key("stepType", 6, "repeat"),
                "numberOfIterations": s["reps"], "smartRepeat": False,
                "endCondition": key("conditionType", 7, "iterations"), "endConditionValue": float(s["reps"]),
                "workoutSteps": [step(x, order) for x in s["steps"]]}
    end = (key("conditionType", 2, "time"), s["min"] * 60) if s.get("min")         else (key("conditionType", 3, "distance"), s["km"] * 1000) if s.get("km")         else (key("conditionType", 1, "lap.button"), None)
    zone = s.get("zone")
    return {"type": "ExecutableStepDTO", "stepOrder": order[0], "stepType": key("stepType", *STEP.get(s["type"], (3, "interval"))),
            "endCondition": end[0], "endConditionValue": end[1],
            "targetType": {"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone", "displayOrder": 4} if zone
            else {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
            "zoneNumber": zone, "description": (s.get("text") or "")[:500]}


def workout(s: dict) -> dict:
    order = [0]
    legs = s.get("legs") or [s]
    segments = [{"segmentOrder": i + 1, "sportType": sport(leg["type"]),
                 "workoutSteps": [step(x, order) for x in (leg.get("steps") or [{"type": "interval", "min": leg["min"], "text": leg.get("title", "")}])]}
                for i, leg in enumerate(legs)]
    return {"workoutName": f"Pulse · {s['title']}"[:80], "description": s.get("why"),
            "sportType": sport("multi_sport" if s.get("legs") else s["type"]), "isWheelchair": False,
            "estimatedDurationInSecs": int(s["min"] * 60), "workoutSegments": segments}


def main() -> None:
    week, dry, approved = sys.argv[1], "--dry" in sys.argv, "--approved" in sys.argv
    path = PLANS / f"{week}.json"
    plan = json.loads(path.read_text(encoding="utf-8"))
    if not (plan["status"] == "approved" or (plan["status"] == "draft" and approved)):
        print(f"{week}: status is {plan['status']}, nothing to send")
        return
    api = None if dry else __import__("pull").connect()
    for s in plan["sessions"]:
        if s.get("garminWorkoutId"):
            continue  # already on Garmin from an earlier run
        w = workout(s)
        if dry:
            print(s["date"], w["workoutName"], len(w["workoutSegments"]), "segment(s)",
                  sum(len(seg["workoutSteps"]) for seg in w["workoutSegments"]), "steps")
            continue
        made = api.upload_workout(w)
        s["garminWorkoutId"] = made["workoutId"]
        api.schedule_workout(made["workoutId"], s["date"])
        path.write_text(json.dumps(plan, indent=2), encoding="utf-8")  # save after each, so a failure never re-sends
        print(f"sent {s['date']} {s['title']}")
    if not dry:
        plan["status"] = "sent"  # every session now carries its Garmin id
        path.write_text(json.dumps(plan, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
