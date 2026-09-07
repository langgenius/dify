import asyncio
import json
import runpy
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from unittest.mock import patch

from kfs_sandbox.admission import Rejected
from kfs_sandbox.conversion import record_failure
from kfs_sandbox.gateway import Settings
from kfs_sandbox.worker import apply_limits, execute, inspect_multipart, main
from tests.test_gateway import multipart


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    def test_entrypoint_keeps_a_single_admission_supervisor(self):
        with patch("uvicorn.run") as run:
            runpy.run_module("kfs_sandbox", run_name="__main__")
        self.assertEqual(run.call_args.kwargs["workers"], 1)
        self.assertEqual(run.call_args.kwargs["limit_concurrency"], 64)

    def test_invalid_and_batched_multipart_is_explicitly_rejected(self):
        for content_type in (
            "application/json",
            "multipart/form-data; boundary=fixture\r\nBad: bad",
        ):
            with self.assertRaisesRegex(Rejected, "multipart_required"):
                inspect_multipart(b"", content_type)
        with self.assertRaisesRegex(Rejected, "multipart_invalid"):
            inspect_multipart(b"bad", "multipart/form-data; boundary=fixture")
        with self.assertRaisesRegex(Rejected, "multipart_files"):
            inspect_multipart(
                multipart().replace(b"--fixture--\r\n", b"") + multipart(),
                "multipart/form-data; boundary=fixture",
            )
        with self.assertRaisesRegex(Rejected, "multipart_files"):
            inspect_multipart(
                b'--fixture\r\nContent-Disposition: form-data; name="strategy"\r\n\r\nfast\r\n--fixture--\r\n',
                "multipart/form-data; boundary=fixture",
            )

    def test_resource_limits_are_applied_before_provider_load(self):
        with (
            patch("kfs_sandbox.worker.resource.setrlimit") as apply,
            patch("kfs_sandbox.worker.sys.platform", "linux"),
        ):
            apply_limits(asdict(Settings()))
        self.assertEqual(len(apply.call_args_list), 5)

    def test_multipart_field_and_nested_part_limits(self):
        field = (
            b'--fixture\r\nContent-Disposition: form-data; name="a"\r\n\r\nvalue\r\n'
        )
        with self.assertRaisesRegex(Rejected, "multipart_fields"):
            inspect_multipart(
                field * 129 + b"--fixture--\r\n",
                "multipart/form-data; boundary=fixture",
            )
        nested = b'--fixture\r\nContent-Disposition: form-data; name="a"\r\nContent-Type: multipart/mixed; boundary=inner\r\n\r\n--inner\r\n\r\nbody\r\n--inner--\r\n--fixture--\r\n'
        with self.assertRaisesRegex(Rejected, "multipart_invalid"):
            inspect_multipart(nested, "multipart/form-data; boundary=fixture")

    async def test_provider_missing_response_is_not_reported_as_success(self):
        async def no_response(scope, receive, send):
            await receive()
            with self.assertRaises(TimeoutError):
                await asyncio.wait_for(receive(), 0.001)
            await send({"type": "http.response.debug"})

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "request.body").write_bytes(multipart())
            with patch(
                "kfs_sandbox.worker.import_from_string",
                return_value=no_response,
            ):
                with self.assertRaisesRegex(RuntimeError, "Missing ASGI response"):
                    await execute(
                        path,
                        {
                            "scope": {
                                "headers": [
                                    (
                                        "content-type",
                                        "multipart/form-data; boundary=fixture",
                                    )
                                ],
                                "query_string": "",
                            },
                            "app_target": "fixture:app",
                            "settings": asdict(Settings()),
                        },
                    )

    async def test_replay_preserves_input_and_complete_response(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "request.body").write_bytes(multipart())
            await execute(
                root,
                {
                    "settings": asdict(Settings()),
                    "app_target": "tests.fake_provider:app",
                    "scope": {
                        "headers": [
                            ("content-type", "multipart/form-data; boundary=fixture")
                        ],
                        "query_string": "",
                    },
                },
            )
            self.assertEqual(
                json.loads((root / "response.json").read_text())["status"], 201
            )

    async def test_provider_cannot_turn_caught_converter_rejection_into_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "request.body").write_bytes(multipart())

            async def swallowed_error(scope, receive, send):
                await receive()
                record_failure(root, "worker_resource_limit")
                await send({"type": "http.response.start", "status": 200})
                await send({"type": "http.response.body", "body": b"[]"})

            with (
                patch(
                    "kfs_sandbox.worker.import_from_string",
                    return_value=swallowed_error,
                ),
                self.assertRaisesRegex(Rejected, "worker_resource_limit"),
            ):
                await execute(
                    root,
                    {
                        "settings": asdict(Settings()),
                        "app_target": "fixture:app",
                        "scope": {
                            "headers": [
                                (
                                    "content-type",
                                    "multipart/form-data; boundary=fixture",
                                )
                            ],
                            "query_string": "",
                        },
                    },
                )
            self.assertFalse((root / "response.json").exists())

    def test_main_writes_safe_failure_classes(self):
        for error, expected in (
            (Rejected("depth"), 422),
            (Rejected("response_bytes"), 413),
            (Rejected("worker_resource_limit"), 413),
            (MemoryError(), 413),
            (ValueError("secret"), 502),
        ):
            with (
                self.subTest(error=type(error).__name__),
                tempfile.TemporaryDirectory() as directory,
            ):
                path = Path(directory)
                (path / "request.json").write_text(
                    json.dumps({"settings": asdict(Settings())})
                )
                with (
                    patch("kfs_sandbox.worker.sys.argv", ["worker", directory]),
                    patch("kfs_sandbox.worker.apply_limits"),
                    patch("kfs_sandbox.worker.asyncio.run", side_effect=error),
                    patch("kfs_sandbox.worker.execute", new=lambda *_: None),
                    patch.dict("kfs_sandbox.worker.os.environ", {}, clear=False),
                ):
                    main()
                result = json.loads((path / "failure.json").read_text())
                self.assertEqual(result["status"], expected)
                self.assertNotIn("secret", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
