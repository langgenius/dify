"""One-time console administration. Test runs use only the resulting Service API key."""

import argparse
import base64
import json
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]
STATE = ROOT / "docker/browser-mvp/state"
p = argparse.ArgumentParser()
p.add_argument("--api", default="http://localhost:15011")
p.add_argument("--model", required=True, help="OpenAI model available to your key; must support tools and vision")
p.add_argument("--key-file", type=Path, required=True)
a = p.parse_args()
admin = json.loads((STATE / "admin.json").read_text())
client = httpx.Client(
    base_url=a.api + "/console/api",
    headers={"Origin": "http://localhost:13000"},
    timeout=120,
    trust_env=False,
)


def call(method, path, body=None):
    for cookie in client.cookies.jar:
        if "csrf" in cookie.name:
            client.headers["X-CSRF-Token"] = cookie.value
    r = client.request(method, path, json=body)
    if not r.is_success:
        raise RuntimeError(
            f"{method} {path}: HTTP {r.status_code} {r.json().get('code', '')}"
        )
    return r.json() if r.content else {}


if call("GET", "/setup").get("step") == "not_started":
    call("POST", "/setup", admin)
call(
    "POST",
    "/login",
    {
        "email": admin["email"],
        "password": base64.b64encode(admin["password"].encode()).decode(),
        "remember_me": True,
    },
)
config_path = STATE / "agent.json"
if config_path.exists():
    print("Already provisioned; use state/agent.json.")
    raise SystemExit()
identifier = "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340"
call(
    "POST",
    "/workspaces/current/plugin/install/marketplace",
    {"plugin_unique_identifiers": [identifier]},
)
provider = "langgenius/openai/openai"
for attempt in range(90):
    providers = call("GET", "/workspaces/current/plugin/list?page=1&page_size=100").get(
        "plugins", []
    )
    if any(item.get("plugin_id") == "langgenius/openai" for item in providers):
        break
    time.sleep(2)
else:
    raise RuntimeError(
        "Model plugin not discoverable yet; wait for installation and retry."
    )
call(
    "POST",
    "/workspaces/current/model-providers/" + provider + "/credentials",
    {
        "name": "Browser MVP model",
        "credentials": {"openai_api_key": a.key_file.read_text().strip()},
    },
)

agent = call(
    "POST",
    "/agent",
    {
        "name": "Browser MVP Service API",
        "description": "Single-user browser acceptance with screenshot delivery and human handoff.",
    },
)
agent_id = agent["id"]
soul = call("GET", "/agent/" + agent_id + "/composer")["agent_soul"]
soul["model"] = {
    "plugin_id": "langgenius/openai",
    "model_provider": provider,
    "model": a.model,
    "model_settings": {"reasoning_effort": "low", "max_tokens": 4096},
}
soul["prompt"] = {"system_prompt": (ROOT / "docker/browser-mvp/prompt.md").read_text()}
call(
    "PUT",
    "/agent/" + agent_id + "/composer",
    {
        "variant": "agent_app",
        "save_strategy": "save_to_current_version",
        "agent_soul": soul,
    },
)
call(
    "POST",
    "/agent/" + agent_id + "/publish",
    {"version_note": "Browser MVP acceptance"},
)
call("POST", "/agent/" + agent_id + "/api-enable", {"enable_api": True})
key = call("POST", "/agent/" + agent_id + "/api-keys")
result = {
    "id": agent_id,
    "api_base": a.api + "/v1",
    "key": key["token"],
    "user": "browser-mvp-operator",
}
config_path.write_text(json.dumps(result, indent=2))
config_path.chmod(0o600)
print("Provisioned and published Agent:", agent_id)
