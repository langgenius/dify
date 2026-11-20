"""Local fictional maintenance portal. No connection to any business system."""

import json
import os
import secrets
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
sessions = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def session(self):
        c = SimpleCookie(self.headers.get("Cookie", ""))
        sid = c["demo"].value if "demo" in c else ""
        return sessions.get(sid)

    def send(self, status, data, kind="application/json", cookie=None):
        b = (
            data.encode()
            if isinstance(data, str)
            else json.dumps(data, ensure_ascii=False).encode()
        )
        self.send_response(status)
        self.send_header("Content-Type", kind + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/":
            return self.send(200, (ROOT / "portal.html").read_text(), "text/html")
        if self.path == "/state":
            return self.send(200, self.session() or {"authenticated": False})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        data = json.loads(
            self.rfile.read(int(self.headers.get("Content-Length", 0))) or "{}"
        )
        if self.path == "/login":
            if data.get("code") != os.environ["DEMO_VERIFICATION_CODE"]:
                return self.send(403, {"error": "测试验证码不正确，请由操作者输入。"})
            sid = secrets.token_hex(20)
            state = {
                "authenticated": True,
                "ticket": None,
                "events": [
                    {
                        "time": time.strftime("%H:%M:%S"),
                        "action": "测试验证码校验通过，进入工单系统",
                    }
                ],
            }
            sessions[sid] = state
            return self.send(
                200, state, cookie=f"demo={sid}; HttpOnly; SameSite=Lax; Path=/"
            )
        state = self.session()
        if not state:
            return self.send(401, {"error": "请先由操作者完成验证码"})
        if self.path == "/submit":
            if state["ticket"]:
                return self.send(409, {"error": "此会话已经提交，请检查原记录"})
            if not all(
                data.get(k)
                for k in [
                    "customer",
                    "engine",
                    "part",
                    "date",
                    "priority",
                    "issue",
                    "contact",
                ]
            ):
                return self.send(400, {"error": "请填写全部必填项"})
            state["ticket"] = {
                "id": "DEMO-" + secrets.token_hex(3).upper(),
                "fields": data,
                "submitted_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            state["events"].append(
                {
                    "time": time.strftime("%H:%M:%S"),
                    "action": "服务器收到 Submit，已创建工单 " + state["ticket"]["id"],
                }
            )
            return self.send(200, state)
        self.send(404, {"error": "not found"})


ThreadingHTTPServer(("0.0.0.0", 16081), Handler).serve_forever()
