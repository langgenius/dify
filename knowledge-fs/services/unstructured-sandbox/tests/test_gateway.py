import asyncio
import json
import os
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import psutil

from kfs_sandbox.gateway import Gateway, Settings


def multipart(filename="sample.txt", body=b"content"):
    return (
        b'--fixture\r\nContent-Disposition: form-data; name="files"; filename="'
        + filename.encode()
        + b'"\r\nContent-Type: application/octet-stream\r\n\r\n'
        + body
        + b"\r\n--fixture--\r\n"
    )


async def request(
    gateway,
    body,
    mode=b"echo",
    disconnect=None,
    path="/general/v0/general",
    method="POST",
    blocked_send=False,
):
    received = False
    output = []

    async def receive():
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": body}
        if disconnect is not None:
            await asyncio.sleep(disconnect)
            return {"type": "http.disconnect"}
        await asyncio.Event().wait()

    async def send(message):
        output.append(message)
        if blocked_send:
            await asyncio.Event().wait()

    await gateway(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": [
                (b"content-type", b"multipart/form-data; boundary=fixture"),
                (b"x-test-mode", mode),
            ],
            "query_string": b"",
            "http_version": "1.1",
            "scheme": "http",
            "server": ("localhost", 8000),
            "client": ("127.0.0.1", 1234),
        },
        receive,
        send,
    )
    return output


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="kfs-sandbox-test-")
        self.settings = Settings(
            temp_root=self.directory.name,
            wall_seconds=5,
            memory_bytes=512 * 1024 * 1024,
            address_space_bytes=16 * 1024**3,
        )

    def tearDown(self):
        self.directory.cleanup()

    def gateway(self, **overrides):
        return Gateway(
            replace(self.settings, **overrides), app_target="tests.fake_provider:app"
        )

    async def test_original_asgi_status_and_body_are_preserved_in_separate_process(
        self,
    ):
        body = multipart()
        output = await request(self.gateway(), body)
        self.assertEqual(output[0]["status"], 201)
        result = json.loads(b"".join(event.get("body", b"") for event in output))
        self.assertEqual(result["input_bytes"], len(body))
        self.assertNotEqual(result["worker"], os.getpid())
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])

    async def test_body_cap_is_checked_before_worker_start(self):
        output = await request(self.gateway(input_bytes=20), multipart())
        self.assertEqual(output[0]["status"], 413)

    async def test_response_cap_is_enforced_inside_worker(self):
        output = await request(
            self.gateway(response_bytes=100), multipart(), mode=b"large"
        )
        self.assertEqual(output[0]["status"], 413)
        self.assertIn(b"response_bytes", output[-1]["body"])

    async def test_wall_deadline_kills_the_request_process(self):
        output = await request(
            self.gateway(wall_seconds=0.4), multipart(), mode=b"wait"
        )
        self.assertEqual(output[0]["status"], 504)
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])

    async def test_disconnect_releases_admission_and_removes_request_files(self):
        gateway = self.gateway()
        output = await request(gateway, multipart(), mode=b"wait", disconnect=0.2)
        self.assertEqual(output, [])
        self.assertEqual(gateway.active, 0)
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])

    async def test_shared_admission_rejects_overflow_without_spawning(self):
        gateway = self.gateway(active_limit=1, queue_limit=0, wall_seconds=0.4)
        first = asyncio.create_task(request(gateway, multipart(), mode=b"wait"))
        while gateway.active == 0:
            await asyncio.sleep(0)
        second = await request(gateway, multipart())
        self.assertEqual(second[0]["status"], 429)
        await first

    async def test_unknown_route_does_not_run_provider(self):
        output = await request(self.gateway(), b"", path="/unknown")
        self.assertEqual(output[0]["status"], 404)

    async def test_health_reports_policy_revision_without_loading_provider(self):
        output = await request(self.gateway(), b"", path="/healthcheck", method="GET")
        self.assertEqual(output[0]["status"], 200)
        self.assertIn(b"sandbox-v1", output[-1]["body"])

    async def test_nested_invalid_document_is_rejected_before_provider(self):
        output = await request(self.gateway(), multipart("a.docx", b"bad zip"))
        self.assertEqual(output[0]["status"], 422)

    async def test_timeout_kills_spawned_conversion_descendants(self):
        gateway = self.gateway(wall_seconds=0.7)
        task = asyncio.create_task(request(gateway, multipart(), mode=b"spawn"))
        descendant = None
        for _ in range(50):
            paths = list(Path(self.directory.name).glob("*/descendant.pid"))
            if paths:
                descendant = int(paths[0].read_text())
                break
            await asyncio.sleep(0.01)
        self.assertIsNotNone(descendant)
        output = await task
        self.assertEqual(output[0]["status"], 504)
        try:
            self.assertEqual(psutil.Process(descendant).status(), psutil.STATUS_ZOMBIE)
        except psutil.NoSuchProcess:
            pass

    async def test_resource_limits_stop_worker_without_overloading_machine(self):
        for limits, mode in (
            ({"memory_bytes": 1}, b"wait"),
            ({"temp_bytes": 1}, b"wait"),
            ({"process_limit": 1}, b"spawn"),
        ):
            with self.subTest(limits=limits):
                output = await request(self.gateway(**limits), multipart(), mode=mode)
                self.assertEqual(output[0]["status"], 413)
                self.assertEqual(self.gateway().active, 0)

    async def test_full_queue_expires_without_leaking_admission(self):
        gateway = self.gateway(queue_seconds=0.02, wall_seconds=0.3)
        first = asyncio.create_task(request(gateway, multipart(), mode=b"wait"))
        while gateway.active == 0:
            await asyncio.sleep(0)
        output = await request(gateway, multipart())
        self.assertEqual(output[0]["status"], 429)
        self.assertIn(b"admission_timeout", output[-1]["body"])
        await first
        self.assertEqual(gateway.queued, 0)
        self.assertEqual(gateway.active, 0)

    async def test_simultaneous_burst_cannot_reserve_more_than_total_admission(self):
        gateway = self.gateway(active_limit=1, queue_limit=0, wall_seconds=0.3)

        class YieldingSemaphore(asyncio.Semaphore):
            async def acquire(self):
                await asyncio.sleep(0)
                return await super().acquire()

        gateway.slots = YieldingSemaphore(1)
        tasks = [
            asyncio.create_task(request(gateway, multipart(), mode=b"wait"))
            for _ in range(20)
        ]
        await asyncio.sleep(0)
        observed = gateway.active + gateway.queued
        output = await asyncio.gather(*tasks)
        self.assertLessEqual(observed, 1)
        self.assertEqual(sum(result[0]["status"] == 429 for result in output), 19)

    async def test_slow_response_client_cannot_hold_admission_past_deadline(self):
        gateway = self.gateway(wall_seconds=0.3)
        output = await asyncio.wait_for(
            request(gateway, multipart(), blocked_send=True), timeout=1
        )
        self.assertEqual(
            [
                item["status"]
                for item in output
                if item["type"] == "http.response.start"
            ],
            [201],
        )
        self.assertEqual(gateway.active, 0)

    async def test_filesystem_failure_does_not_leak_slot(self):
        gateway = self.gateway()
        with patch("kfs_sandbox.gateway.tempfile.mkdtemp", side_effect=OSError):
            output = await request(gateway, multipart())
        self.assertEqual(output[0]["status"], 503)
        self.assertEqual(gateway.active, 0)

    async def test_body_receipt_disconnect_and_deadline_are_bounded(self):
        gateway = self.gateway(wall_seconds=0.01)
        for event in ({"type": "http.disconnect"}, None):
            output = []

            async def receive():
                if event is not None:
                    return event
                await asyncio.Event().wait()

            async def send(message):
                output.append(message)

            await gateway(
                {"type": "http", "path": "/general/v0/general", "method": "POST"},
                receive,
                send,
            )
            self.assertEqual(gateway.active, 0)
            if event is None:
                self.assertEqual(output[0]["status"], 504)
            else:
                self.assertEqual(output, [])

    async def test_lifespan_completes_and_websockets_are_not_parser_jobs(self):
        events = iter([{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}])
        output = []

        async def receive():
            return next(events)

        async def send(message):
            output.append(message)

        gateway = self.gateway()
        await gateway({"type": "lifespan"}, receive, send)
        await gateway({"type": "websocket"}, receive, send)
        self.assertEqual(
            [item["type"] for item in output],
            ["lifespan.startup.complete", "lifespan.shutdown.complete"],
        )

    def test_invalid_limits_fail_startup(self):
        for values in (
            {"memory_bytes": 0},
            {"active_limit": 9},
            {"queue_limit": 65},
            {"queue_limit": -1},
        ):
            with self.assertRaises(ValueError):
                replace(self.settings, **values)


if __name__ == "__main__":
    unittest.main()
