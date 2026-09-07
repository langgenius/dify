"""Disposable ASGI replay worker. Resource limits precede any provider imports."""

from __future__ import annotations

import asyncio
from uvicorn.importer import import_from_string
import json
import os
import resource
import sys
from email import policy
from email.parser import BytesParser
from pathlib import Path

from .admission import Budget, Rejected, inspect_document
from .conversion import initialize_budget, load_budget


def apply_limits(settings: dict) -> None:
    for key, value in (
        (resource.RLIMIT_CPU, int(settings["cpu_seconds"])),
        (resource.RLIMIT_FSIZE, settings["file_bytes"]),
        (resource.RLIMIT_NOFILE, 256),
    ):
        resource.setrlimit(key, (value, value))
    # macOS exposes RLIMIT_AS but cannot reliably apply it; production image is Linux.
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (settings["address_space_bytes"],) * 2)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def inspect_multipart(body: bytes, content_type: str) -> Budget:
    if (
        not content_type.lower().startswith("multipart/form-data;")
        or "\r" in content_type
        or "\n" in content_type
    ):
        raise Rejected("multipart_required")
    message = BytesParser(policy=policy.default).parsebytes(
        b"MIME-Version: 1.0\r\nContent-Type: "
        + content_type.encode("latin-1")
        + b"\r\n\r\n"
        + body
    )
    if not message.is_multipart() or message.defects:
        raise Rejected("multipart_invalid")
    budget = Budget()
    file_count = 0
    fields = 0
    for part in message.iter_parts():
        fields += 1
        if fields > 128:
            raise Rejected("multipart_fields")
        if part.defects or part.is_multipart():
            raise Rejected("multipart_invalid")
        if part.get_filename() is None:
            continue
        # KnowledgeFS submits exactly one document per request. Upstream batch semantics
        # are deliberately unavailable on this optional, internal-only service boundary.
        file_count += 1
        if file_count > 1:
            raise Rejected("multipart_files")
        data = part.get_payload(decode=True)
        if data is None:
            raise Rejected("multipart_invalid")
        inspect_document(data, part.get_filename(), budget)
    if file_count != 1:
        raise Rejected("multipart_files")
    return budget


async def execute(directory: Path, envelope: dict) -> None:
    body = (directory / "request.body").read_bytes()
    scope = envelope["scope"]
    scope["headers"] = [
        (name.encode("latin-1"), value.encode("latin-1"))
        for name, value in scope["headers"]
    ]
    scope["query_string"] = scope["query_string"].encode("latin-1")
    budget = inspect_multipart(
        body, dict(scope["headers"]).get(b"content-type", b"").decode("latin-1")
    )
    initialize_budget(
        directory, budget, wall_seconds=envelope["settings"]["wall_seconds"]
    )
    app = import_from_string(envelope["app_target"])
    supplied = False
    response_size = 0
    start = None

    async def receive():
        nonlocal supplied
        if not supplied:
            supplied = True
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.Event().wait()

    with (directory / "response.body").open("wb") as output:

        async def send(message):
            nonlocal response_size, start
            if message["type"] == "http.response.start":
                start = {
                    "status": message["status"],
                    "headers": [
                        (name.decode("latin-1"), value.decode("latin-1"))
                        for name, value in message.get("headers", [])
                    ],
                }
            elif message["type"] == "http.response.body":
                chunk = message.get("body", b"")
                response_size += len(chunk)
                if response_size > envelope["settings"]["response_bytes"]:
                    raise Rejected("response_bytes")
                output.write(chunk)

        try:
            await app(scope, receive, send)
        finally:
            # The upstream API may catch a converter's failure or skip an attachment.
            # A sticky shared admission rejection must still reject the whole document.
            _, failure = load_budget(directory)
            if failure:
                raise Rejected(failure)
    if start is None:
        raise RuntimeError("Missing ASGI response")
    (directory / "response.json").write_text(json.dumps(start))


def main() -> None:
    directory = Path(sys.argv[1])
    envelope = json.loads((directory / "request.json").read_text())
    apply_limits(envelope["settings"])
    # A request must not recursively wait on the service-wide admission queue it owns.
    # Serial local partition preserves semantics; throughput is a required rollout gate.
    os.environ["UNSTRUCTURED_PARALLEL_MODE_ENABLED"] = "false"
    os.environ["TMPDIR"] = str(directory)
    os.environ["XDG_CONFIG_HOME"] = str(directory / "config")
    os.environ["KFS_CONVERSION_DIRECTORY"] = str(directory)
    try:
        asyncio.run(execute(directory, envelope))
    except Rejected as error:
        (directory / "failure.json").write_text(
            json.dumps(
                {
                    "status": 504
                    if error.reason == "wall_seconds"
                    else 413
                    if error.reason in {"response_bytes", "worker_resource_limit"}
                    else 422,
                    "reason": error.reason,
                }
            )
        )
    except (MemoryError, OSError):
        (directory / "failure.json").write_text(
            json.dumps({"status": 413, "reason": "worker_resource_limit"})
        )
    except Exception:
        # Never copy untrusted provider exception strings or file paths into an error.
        (directory / "failure.json").write_text(
            json.dumps({"status": 502, "reason": "worker_failed"})
        )


if __name__ == "__main__":
    main()
