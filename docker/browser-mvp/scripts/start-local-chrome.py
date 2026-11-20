"""Start a dedicated visible local Chrome and an authenticated Docker-only-use relay."""

import argparse
import json
import secrets
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
STATE = ROOT / "docker/browser-mvp/state"
p = argparse.ArgumentParser()
p.add_argument(
    "--chrome", default="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)
p.add_argument("--debug-port", type=int, default=19222)
p.add_argument("--bridge-port", type=int, default=19223)
p.add_argument("--url", default="http://localhost:16091")
a = p.parse_args()
if not Path(a.chrome).exists():
    raise SystemExit("Pass --chrome with your Chrome executable path.")
token = STATE / "host-token"
if not token.exists():
    token.write_text(secrets.token_urlsafe(32))
    token.chmod(0o644)
# Parent state directory is private; the file is mounted read-only into the relay.
profile = STATE / "chrome-profile"
log = (STATE / "local-chrome.log").open("a")
chrome = subprocess.Popen(
    [
        a.chrome,
        "--user-data-dir=" + str(profile),
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=" + str(a.debug_port),
        "--no-first-run",
        "--no-default-browser-check",
        a.url,
    ],
    stdin=subprocess.DEVNULL,
    stdout=log,
    stderr=log,
    start_new_session=True,
)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _ in range(40):
    try:
        with opener.open(
            f"http://127.0.0.1:{a.debug_port}/json/version", timeout=1
        ) as response:
            json.load(response)
        break
    except OSError:
        time.sleep(0.25)
else:
    raise SystemExit("Chrome CDP did not become ready.")
bridge_log = (STATE / "host-bridge.log").open("a")
bridge = subprocess.Popen(
    [
        sys.executable,
        str(ROOT / "docker/browser-mvp/gateway/cdp_gateway.py"),
        "--upstream",
        f"http://127.0.0.1:{a.debug_port}",
        "--port",
        str(a.bridge_port),
        "--require-token",
        str(token),
    ],
    stdin=subprocess.DEVNULL,
    stdout=bridge_log,
    stderr=bridge_log,
    start_new_session=True,
)
(STATE / "local-processes.json").write_text(
    json.dumps({"chrome": chrome.pid, "bridge": bridge.pid})
)
print(
    "Dedicated Chrome and authenticated bridge started. Daily Chrome profile was not used."
)
