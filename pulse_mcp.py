r"""Local helper behind the dashboard's Refresh button: a tiny MCP server (stdio, no extra packages).

Registered once with:  claude mcp add --scope user pulse -- <venv python> <this file>
The page, opened in the Claude desktop app on this laptop, calls it as "host:pulse":
  refresh  starts pull.py 2 -> history.py 3 -> variants\extract.py in the background
  latest   says whether that is still running, and returns the newest dashboard data
A Garmin pull takes longer than one call may wait, so the page calls refresh once, then latest
every few seconds. Nothing here publishes: the published link still updates on the morning run.
"""

import json
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).parent
PY = ROOT / ".venv" / "Scripts" / "python.exe"
STEPS = [["pull.py", "2"], ["history.py", "3"], ["variants/extract.py"]]
state = {"running": False, "error": None}

TOOLS = [
    {"name": "refresh", "description": "Pull the last days from Garmin and rebuild the dashboard data, in the background.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "latest", "description": "Whether a refresh is running, and the newest dashboard data.",
     "inputSchema": {"type": "object", "properties": {}}, "annotations": {"readOnlyHint": True}},
]


def run_steps() -> None:
    try:
        for step in STEPS:  # stdin closed: a Garmin MFA prompt fails fast instead of hanging
            done = subprocess.run([str(PY), *step], cwd=ROOT, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=600)
            if done.returncode:
                state["error"] = f"{' '.join(step)} failed: {(done.stderr or done.stdout).strip().splitlines()[-1:]}"
                return
        state["error"] = None
    except Exception as e:
        state["error"] = str(e)
    finally:
        state["running"] = False


def latest() -> dict:
    out = {"running": state["running"], "error": state["error"]}
    for line in (ROOT / "variants" / "data.js").read_text(encoding="utf-8").splitlines():
        name, _, value = line.partition(" = ")  # data.js is three lines: window.G / window.PLAN / window.MEMORY = <json>;
        out[name.removeprefix("window.")] = json.loads(value.rstrip(";"))
    return out


def call(name: str) -> dict:
    if name == "refresh":
        if not state["running"]:
            state.update(running=True, error=None)
            threading.Thread(target=run_steps, daemon=True).start()
        return {"started": True}
    if name == "latest":
        return latest()
    raise ValueError(f"unknown tool {name}")


def answer(msg: dict) -> dict | None:
    method, mid = msg.get("method"), msg.get("id")
    if mid is None:
        return None  # notifications need no reply
    if method == "initialize":
        result = {"protocolVersion": msg["params"].get("protocolVersion", "2025-06-18"),
                  "capabilities": {"tools": {}}, "serverInfo": {"name": "pulse", "version": "1.0"}}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        try:
            data = call(msg["params"]["name"])
            summary = {k: v for k, v in data.items() if k not in ("G", "PLAN", "MEMORY")}  # the page reads structuredContent
            result = {"content": [{"type": "text", "text": json.dumps(summary)}], "structuredContent": data}
        except Exception as e:
            result = {"content": [{"type": "text", "text": str(e)}], "isError": True}
    elif method == "ping":
        result = {}
    else:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"no method {method}"}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def main() -> None:
    for line in sys.stdin:
        if line.strip():
            reply = answer(json.loads(line))
            if reply:
                sys.stdout.write(json.dumps(reply) + "\n")
                sys.stdout.flush()


if __name__ == "__main__":
    main()
