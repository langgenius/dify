"""Run the acceptance through Agent Service API only; human steps are external."""

import argparse
import hashlib
import json
import re
import shutil
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[3]
STATE = ROOT / "docker/browser-mvp/state"
p = argparse.ArgumentParser()
p.add_argument("stage", choices=["wait", "prefill", "receipt"])
p.add_argument("--session", default="novnc")
p.add_argument("--url", default="http://fixture:16081")
p.add_argument("--expected-date", default="2026-12-10")
p.add_argument("--expected-note", default="Reviewed - pickup Tuesday")
a = p.parse_args()
if not re.fullmatch(r"[a-zA-Z0-9_-]+", a.session):
    raise SystemExit(
        "Session must contain only letters, numbers, underscores or hyphens."
    )
config = json.loads((STATE / "agent.json").read_text())
run_dir = STATE / a.session
run_dir.mkdir(exist_ok=True)
history = run_dir / "history"
history.mkdir(exist_ok=True)
for old in run_dir.glob(a.stage + "*"):
    if old.is_file():
        shutil.copy2(old, history / (str(time.time_ns()) + "-" + old.name))
conversation_path = run_dir / "conversation.json"
conversation = (
    json.loads(conversation_path.read_text()) if conversation_path.exists() else {}
)
prompts = {
    "wait": f"连接浏览器，找到或打开 {a.url} 维修工单页面。读取附件备用。遇到人工验证码就停止并等待，不填写或猜测验证码，不提交。",
    "prefill": "人工已在同一浏览器完成验证码。请先确认已进入表单，再按附件填写。复核备注留空，不勾选确认，不 Submit。截图、read_media 核对，然后务必用 dify-agent file upload 上传截图，在回复中给出截图的 Markdown 图片和下载链接，最后结束本轮等待人工提交。",
    "receipt": "人工已修改字段并亲自 Submit。请从页面独立读出实际修改值，不要假设其内容。请只读取实际回执，报告工单号和最终字段，与附件比较。截图、read_media 核对并上传截图，在回复中包含图片及下载链接。不重新提交。",
}
with httpx.Client(
    base_url=config["api_base"],
    headers={"Authorization": "Bearer " + config["key"]},
    timeout=240,
    trust_env=False,
) as client:
    payload = {
        "inputs": {},
        "response_mode": "streaming",
        "user": config["user"] + "-" + a.session,
        "query": prompts[a.stage],
    }
    if conversation.get("id"):
        payload["conversation_id"] = conversation["id"]
    else:
        with (ROOT / "docker/browser-mvp/fixture/维修申请-虚构资料.txt").open(
            "rb"
        ) as f:
            r = client.post(
                "/files/upload",
                files={"file": ("maintenance.txt", f, "text/plain")},
                data={"user": payload["user"]},
            )
        r.raise_for_status()
        payload["files"] = [
            {
                "type": "document",
                "transfer_method": "local_file",
                "upload_file_id": r.json()["id"],
            }
        ]
    answer = ""
    ended = False
    with client.stream("POST", "/chat-messages", json=payload) as response:
        response.raise_for_status()
        with (run_dir / (a.stage + ".sse")).open("w") as out:
            for line in response.iter_lines():
                out.write(line + "\n")
                out.flush()
                if not line.startswith("data: "):
                    continue
                d = json.loads(line[6:])
                event = d.get("event")
                if d.get("conversation_id"):
                    conversation_path.write_text(
                        json.dumps({"id": d["conversation_id"]})
                    )
                if event == "agent_message":
                    answer += d.get("answer", "")
                elif event == "message" and not answer:
                    answer = d.get("answer", "")
                if event == "error":
                    raise RuntimeError(d.get("message", "Agent run failed"))
                if event == "message_end":
                    ended = True
    if not ended:
        raise RuntimeError("Stream ended without message_end")
    (run_dir / (a.stage + ".md")).write_text(answer)
    print(answer)
    urls = set(re.findall(r"https?://[^\s<>\)]+", answer))
    screenshots = []
    for url in urls:
        if (
            "/files/" not in url
            or urlsplit(url).netloc != urlsplit(config["api_base"]).netloc
        ):
            continue
        # Signed file URLs are fetched without forwarding the Agent API credential.
        with httpx.Client(trust_env=False, timeout=30) as download:
            r = download.get(url)
        r.raise_for_status()
        if r.content.startswith(b"\x89PNG\r\n\x1a\n"):
            path = run_dir / (a.stage + f"-{len(screenshots) + 1}.png")
            path.write_bytes(r.content)
            screenshots.append(
                {
                    "path": str(path),
                    "bytes": len(r.content),
                    "sha256": hashlib.sha256(r.content).hexdigest(),
                    "status": r.status_code,
                }
            )
    (run_dir / (a.stage + "-verification.json")).write_text(
        json.dumps({"completed": ended, "screenshots": screenshots}, indent=2)
    )
    if a.stage != "wait" and not screenshots:
        raise RuntimeError("No delivered PNG screenshot verified")
    if a.stage == "receipt":
        ticket = re.search(r"DEMO-[A-F0-9]{6}", answer)
        if not ticket or a.expected_date not in answer or a.expected_note not in answer:
            raise RuntimeError(
                "Receipt must contain the observed ticket ID and independently expected human edits"
            )
        (run_dir / "acceptance.json").write_text(
            json.dumps(
                {
                    "ticket": ticket.group(),
                    "expected_date": a.expected_date,
                    "expected_note": a.expected_note,
                    "screenshot_verified": True,
                },
                indent=2,
            )
        )
    print("Verified delivered screenshots:", len(screenshots))
