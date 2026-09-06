"""Local-only ASGI fixtures for real worker-process tests; never included in the image."""

import asyncio
import json
import os
import subprocess
import sys


async def app(scope, receive, send):
    body = b""
    while True:
        message = await receive()
        body += message.get("body", b"")
        if not message.get("more_body"):
            break
    mode = dict(scope["headers"]).get(b"x-test-mode", b"echo")
    if mode == b"wait":
        await asyncio.sleep(60)
    if mode == b"spawn":
        process = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(60)"]
        )
        with open(os.path.join(os.environ["TMPDIR"], "descendant.pid"), "w") as output:
            output.write(str(process.pid))
        await asyncio.sleep(60)
    response = (
        b"X" * 10000
        if mode == b"large"
        else json.dumps({"input_bytes": len(body), "worker": os.getpid()}).encode()
    )
    await send(
        {
            "type": "http.response.start",
            "status": 201,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": response})
