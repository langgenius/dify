"""Protocol doubles exercise the actual SDK; subprocess witnesses are separately labelled."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Coroutine
from dataclasses import replace
from pathlib import Path
from typing import override

import httpx2 as httpx
import pytest
from dify_agent.runtime_backend.local import LocalNativeScopeClient
from pydantic import SecretStr
from shellctl.client.sdk import ShellctlClient
from shellctl.shared.schemas import NativeScopeHandle

from runtime_contracts.code_execution import CodeExecutionError
from services.code_execution.native_scope_transport import (
    NativeCodeBounds,
    NativeCodeIdentity,
    NativeCodeProfile,
    NativeScopeCodeExecutionTransport,
)


class DurableOwner:
    def __init__(self) -> None:
        self.claimed = True
        self.reserved = False
        self.jobs: list[str] = []
        self.unknowns = 0

    def assert_claim(self, identity: NativeCodeIdentity) -> None:
        del identity
        if not self.claimed:
            raise ValueError("private claim")

    def reserve_dispatch(self, identity: NativeCodeIdentity, *, payload_digest: str, profile_digest: str) -> None:
        del identity
        assert len(payload_digest) == 64
        assert len(profile_digest) == 64
        if self.reserved:
            raise ValueError("private replay")
        self.reserved = True

    def associate_job(self, identity: NativeCodeIdentity, job_id: str) -> None:
        del identity
        self.jobs.append(job_id)

    def mark_unknown(self, identity: NativeCodeIdentity) -> None:
        del identity
        self.unknowns += 1


class LifetimeOwner:
    def __init__(self) -> None:
        self.current = True
        self.checks = 0
        self.settlements: list[bool] = []

    def check_current(self, identity: NativeCodeIdentity) -> None:
        del identity
        self.checks += 1
        if not self.current:
            raise ValueError("private stale scope")

    async def settle(self, identity: NativeCodeIdentity, *, succeeded: bool) -> None:
        del identity
        self.settlements.append(succeeded)


class SyncOwner:
    def run(self, operation: Callable[[], Coroutine[object, object, str]]) -> str:
        with asyncio.Runner() as runner:
            return runner.run(operation())


def page(
    output: str = "",
    *,
    offset: int | None = None,
    done: bool = True,
    truncated: bool = False,
    status: str | None = None,
    job_id: str = "job-1",
    exit_code: int | None = 0,
) -> dict[str, object]:
    return {
        "job_id": job_id,
        "output": output,
        "offset": len(output.encode()) if offset is None else offset,
        "done": done,
        "status": status or ("exited" if done else "running"),
        "exit_code": exit_code,
        "truncated": truncated,
        "output_path": "/.job/job-1/output.log",
    }


class ScopedSDK(LocalNativeScopeClient):
    """Only HTTP responses/control inspect are doubles; job operations use the real SDK."""

    def __init__(self, outputs: list[dict[str, object]] | None = None) -> None:
        super().__init__(endpoint="https://scope.invalid", auth_token="synthetic-token")
        self.outputs = outputs or [page("<<RESULT>>{}<<RESULT>>\n")]
        self.requests: list[httpx.Request] = []
        self.handle = NativeScopeHandle(
            scope_id="scope-1", generation=2, status="ready", token=SecretStr("scope-token")
        )
        self.final_offset = 0
        self.closed = 0
        self.lost_ack = False
        self.status_delta = 0
        self.durable: DurableOwner | None = None

    @override
    async def inspect(self, scope_id: str, generation: int) -> NativeScopeHandle:
        assert (scope_id, generation) == ("scope-1", 2)
        return self.handle

    @override
    def job_client(self, handle: NativeScopeHandle) -> ShellctlClient:
        owner = self

        class Client(ShellctlClient):
            @override
            async def close(self) -> None:
                owner.closed += 1
                await super().close()

        return Client(
            base_url=self.endpoint,
            token=self.auth_token,
            native_scope=handle,
            transport=httpx.MockTransport(self.respond),
        )

    def respond(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers["X-Scope-Generation"] == "2"
        assert request.headers["X-Scope-Token"] == "scope-token"
        assert request.url.path.startswith("/v1/test-scopes/scope-1/jobs")
        if request.url.path.endswith("/run"):
            if self.lost_ack:
                raise httpx.ReadTimeout("private lost ack", request=request)
            body = json.loads(request.content)
            assert body["cwd"] == "/workspace"
            assert body["mode"] == "stdio"
            assert "env" not in body
            assert "SUBMITTED_SECRET" not in body["script"]
            return httpx.Response(200, json=page(done=False, exit_code=None))
        if request.url.path.endswith("/input"):
            assert self.durable is not None
            assert self.durable.jobs == ["job-1"]
            return httpx.Response(200, json=self.outputs.pop(0))
        if request.url.path.endswith("/wait"):
            return httpx.Response(200, json=self.outputs.pop(0))
        return httpx.Response(
            200,
            json={
                "job_id": "job-1",
                "done": True,
                "status": "exited",
                "exit_code": 0,
                "offset": self.final_offset + self.status_delta,
                "created_at": "now",
            },
        )


def setup_transport(
    outputs: list[dict[str, object]] | None = None, **overrides: object
) -> tuple[NativeScopeCodeExecutionTransport, ScopedSDK, DurableOwner, LifetimeOwner]:
    sdk = ScopedSDK(outputs)
    sdk.final_offset = outputs[-1]["offset"] if outputs else len(b"<<RESULT>>{}<<RESULT>>\n")
    durable, lifetime = DurableOwner(), LifetimeOwner()
    sdk.durable = durable
    args: dict[str, object] = {
        "identity": NativeCodeIdentity(operation_ref="operation-1", scope_id="scope-1", generation=2),
        "profile": NativeCodeProfile(language="python3", executable="/usr/bin/python3", environment_digest="a" * 64),
        "bounds": NativeCodeBounds(
            timeout_seconds=1, output_bytes=1000, max_pages=10, input_bytes=10000, close_seconds=0.2
        ),
        "scope_client": sdk,
        "durable_owner": durable,
        "lifetime_owner": lifetime,
        "sync_owner": SyncOwner(),
    }
    args.update(overrides)
    return NativeScopeCodeExecutionTransport(**args), sdk, durable, lifetime


def execute(transport: NativeScopeCodeExecutionTransport, *, preload: str = "") -> str:
    return transport.execute(language="python3", preload=preload, code="SUBMITTED_SECRET")


def test_preserves_stdout_and_structured_payload_after_durable_association() -> None:
    expected = 'log\n<<RESULT>>{"x":"é"}<<RESULT>>\n'
    transport, sdk, _, lifetime = setup_transport([page(expected)])
    assert execute(transport, preload="preload\n'") == expected
    payload = json.loads(json.loads(sdk.requests[1].content)["text"])
    assert payload == {"preload": "preload\n'", "code": "SUBMITTED_SECRET"}
    assert sdk.closed == 1
    assert lifetime.settlements == [True]


def test_complete_bounded_page_drain_uses_exact_utf8_offsets() -> None:
    transport, sdk, _, _ = setup_transport(
        [page("é", done=False, exit_code=None), page("A", offset=3, truncated=True), page("B", offset=4)]
    )
    assert execute(transport) == "éAB"
    assert [json.loads(r.content)["offset"] for r in sdk.requests if r.url.path.endswith("/wait")] == [2, 3]


@pytest.mark.parametrize(
    "bad",
    [
        page("private", job_id="other"),
        page("é", offset=1),
        page("private", status="failed", exit_code=125),
        page("private", exit_code=1),
        page("private", status="lost"),
        page("private", status="terminated"),
        page("x" * 1001),
        page("", done=False, exit_code=None),
    ],
)
def test_bad_job_output_fails_redacted_and_closes(bad: dict[str, object]) -> None:
    transport, sdk, durable, lifetime = setup_transport([bad])
    with pytest.raises(CodeExecutionError, match="^Native code execution unavailable$"):
        execute(transport)
    assert sdk.closed == 1
    assert durable.unknowns == 1
    assert lifetime.settlements == [False]


@pytest.mark.parametrize("missing", ["durable_owner", "lifetime_owner", "sync_owner"])
def test_missing_owner_refuses_before_io(missing: str) -> None:
    transport, sdk, _, _ = setup_transport(**{missing: None})
    with pytest.raises(CodeExecutionError):
        execute(transport)
    assert sdk.requests == []
    assert sdk.closed == 0


def test_missing_claim_refuses_before_sdk_and_payload_io() -> None:
    transport, sdk, durable, _ = setup_transport()
    durable.claimed = False
    with pytest.raises(CodeExecutionError):
        execute(transport)
    assert not durable.reserved
    assert sdk.requests == []


def test_lost_create_ack_is_unknown_and_new_adapter_cannot_redispatch() -> None:
    transport, sdk, durable, lifetime = setup_transport()
    sdk.lost_ack = True
    with pytest.raises(CodeExecutionError):
        execute(transport)
    other, _, _, _ = setup_transport(scope_client=sdk, durable_owner=durable, lifetime_owner=lifetime)
    with pytest.raises(CodeExecutionError):
        execute(other)
    assert len(sdk.requests) == 1
    assert durable.jobs == []
    assert sdk.closed == 1


@pytest.mark.parametrize("identity", ["scope", "generation", "current"])
def test_wrong_scope_or_generation_refuses(identity: str) -> None:
    transport, sdk, _, lifetime = setup_transport()
    if identity == "current":
        lifetime.current = False
    else:
        sdk.handle = sdk.handle.model_copy(update={"scope_id": "other"} if identity == "scope" else {"generation": 3})
    with pytest.raises(CodeExecutionError):
        execute(transport)
    assert sdk.requests == []


def test_final_status_must_confirm_complete_eof() -> None:
    transport, sdk, _, _ = setup_transport()
    sdk.status_delta = 1
    with pytest.raises(CodeExecutionError):
        execute(transport)
    assert sdk.closed == 1


def test_unsupported_profile_language_refuses_before_io() -> None:
    transport, sdk, _, _ = setup_transport()
    with pytest.raises(CodeExecutionError):
        transport.execute(language="ruby", preload="", code="private")
    assert sdk.requests == []


def test_async_entry_does_not_nest_the_existing_event_loop() -> None:
    transport, sdk, _, _ = setup_transport(sync_owner=None)
    with asyncio.Runner() as runner:
        assert (
            runner.run(transport.execute_async(language="python3", preload="", code="private"))
            == "<<RESULT>>{}<<RESULT>>\n"
        )
    assert sdk.closed == 1


@pytest.mark.parametrize("boundary", ["associate", "current_after_input", "input_timeout", "close", "settle"])
def test_boundary_failure_redacts_and_settles(boundary: str) -> None:
    transport, sdk, durable, lifetime = setup_transport()
    if boundary == "associate":

        def reject(identity: NativeCodeIdentity, job_id: str) -> None:
            del identity, job_id
            raise ValueError("private persistence failure")

        durable.associate_job = reject
    elif boundary == "current_after_input":
        original = sdk.respond

        def respond(request: httpx.Request) -> httpx.Response:
            result = original(request)
            if request.url.path.endswith("/input"):
                lifetime.current = False
            return result

        sdk.respond = respond
    elif boundary == "input_timeout":
        original = sdk.respond

        def respond(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/input"):
                raise httpx.ReadTimeout("private timeout", request=request)
            return original(request)

        sdk.respond = respond
    elif boundary == "close":
        original_factory = sdk.job_client

        def factory(handle: NativeScopeHandle) -> ShellctlClient:
            client = original_factory(handle)
            original_close = client.close

            async def close() -> None:
                await original_close()
                raise ValueError("private close")

            client.close = close
            return client

        sdk.job_client = factory
    else:

        async def settle(identity: NativeCodeIdentity, *, succeeded: bool) -> None:
            del identity
            lifetime.settlements.append(succeeded)
            raise ValueError("private settlement")

        lifetime.settle = settle
    with pytest.raises(CodeExecutionError, match="^Native code execution unavailable$"):
        execute(transport)
    assert sdk.closed == 1
    assert durable.unknowns >= 1
    assert len(lifetime.settlements) == 1
    assert sum(r.url.path.endswith("/input") for r in sdk.requests) <= 1


def test_total_deadline_cancels_wait_and_closes_owned_client() -> None:
    transport, sdk, durable, lifetime = setup_transport()
    transport = replace(transport, bounds=replace(transport.bounds, timeout_seconds=0.01))
    original_factory = sdk.job_client

    def factory(handle: NativeScopeHandle) -> ShellctlClient:
        client = original_factory(handle)

        async def run(*args: object, **kwargs: object) -> None:
            del args, kwargs
            await asyncio.sleep(1)

        client.run = run
        return client

    sdk.job_client = factory
    with pytest.raises(CodeExecutionError):
        execute(transport)
    assert sdk.closed == 1
    assert durable.unknowns == 1
    assert lifetime.settlements == [False]


def test_page_count_exhaustion_never_reports_partial_success() -> None:
    transport, sdk, _, _ = setup_transport([page("A", done=False, exit_code=None), page("B", offset=2)])
    transport = replace(transport, bounds=replace(transport.bounds, max_pages=1))
    with pytest.raises(CodeExecutionError):
        execute(transport)
    assert sdk.closed == 1
    assert not any(r.url.path.endswith("/wait") for r in sdk.requests)


@pytest.mark.parametrize(
    ("bound", "value"),
    [
        ("timeout_seconds", float("inf")),
        ("close_seconds", 0),
        ("max_pages", 0),
        ("max_pages", 1.5),
        ("output_bytes", -1),
        ("input_bytes", 1),
    ],
)
def test_invalid_or_exceeded_bounds_refuse_before_sdk(bound: str, value: float) -> None:
    transport, sdk, _, _ = setup_transport()
    transport = replace(transport, bounds=replace(transport.bounds, **{bound: value}))
    with pytest.raises(CodeExecutionError):
        execute(transport)
    assert sdk.requests == []


@pytest.mark.parametrize("language", ["python3", "javascript", "jinja2"])
def test_actual_offline_runner_transformer_roundtrip_with_sdk_response_double(language: str, tmp_path: Path) -> None:
    """Real interpreter/transformer execution; HTTP/scope/kernel/lifetime remain doubles."""
    import shutil
    import subprocess
    import sys

    from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage

    executable = shutil.which("node") if language == "javascript" else sys.executable
    if executable is None:
        pytest.skip("qualified offline fixture has no Node interpreter; no package install")
    value = "é '$() ` shell\\nline"
    snippets = {
        "python3": "def main(value, typed):\n    print('prefix')\n    return {'answer': value, 'typed': typed}",
        "javascript": (
            "function main(inputs) { console.log('prefix'); return {answer: inputs.value, typed: inputs.typed}; }"
        ),
        "jinja2": "Hello {{ value }}",
    }
    transport, sdk, _, _ = setup_transport(
        profile=NativeCodeProfile(
            language="nodejs" if language == "javascript" else "python3",
            executable=executable,
            environment_digest="a" * 64,
        )
    )
    original = sdk.respond
    captured: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/run"):
            captured.append(json.loads(request.content)["script"])
        if request.url.path.endswith("/input"):
            payload = json.loads(request.content)["text"]
            result = subprocess.run(
                ["/bin/sh", "-c", captured[0]],
                input=payload,
                text=True,
                capture_output=True,
                timeout=3,
                cwd=tmp_path,
                check=False,
            )
            assert result.returncode == 0, result.stderr
            sdk.outputs = [page(result.stdout)]
            sdk.final_offset = len(result.stdout.encode())
        return original(request)

    sdk.respond = respond
    typed = {"nested": [1, True, None, {"x": 2.5}]}
    expected = {"result": "Hello " + value} if language == "jinja2" else {"answer": value, "typed": typed}
    assert (
        CodeExecutor.execute_workflow_code_template(
            CodeLanguage(language), snippets[language], {"value": value, "typed": typed}, transport=transport
        )
        == expected
    )
    assert sdk.closed == 1


def test_actual_python_preload_runs_before_code_and_preserves_stdout(tmp_path: Path) -> None:
    import subprocess
    import sys

    transport, sdk, _, _ = setup_transport(
        profile=NativeCodeProfile(language="python3", executable=sys.executable, environment_digest="a" * 64)
    )
    original = sdk.respond
    scripts: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/run"):
            scripts.append(json.loads(request.content)["script"])
        if request.url.path.endswith("/input"):
            result = subprocess.run(
                ["/bin/sh", "-c", scripts[0]],
                input=json.loads(request.content)["text"],
                text=True,
                capture_output=True,
                timeout=3,
                cwd=tmp_path,
                check=True,
            )
            sdk.outputs = [page(result.stdout)]
            sdk.final_offset = len(result.stdout.encode())
        return original(request)

    sdk.respond = respond
    assert (
        transport.execute(language="python3", preload="value = 'é'\nprint('preload')", code="print(value)")
        == "preload\né\n"
    )


def test_slow_http_close_cannot_escape_settlement_deadline() -> None:
    transport, sdk, durable, lifetime = setup_transport()
    transport = replace(transport, bounds=replace(transport.bounds, close_seconds=0.01))
    original_factory = sdk.job_client

    def factory(handle: NativeScopeHandle) -> ShellctlClient:
        client = original_factory(handle)
        original_close = client.close

        async def close() -> None:
            await original_close()
            await asyncio.sleep(1)

        client.close = close
        return client

    sdk.job_client = factory
    with pytest.raises(CodeExecutionError):
        execute(transport)
    assert lifetime.settlements == [False]
    assert durable.unknowns >= 1


def test_borrowed_http_client_lifetime_is_preserved_by_actual_sdk() -> None:
    transport, sdk, _, _ = setup_transport()

    async def scenario() -> None:
        async with httpx.AsyncClient(base_url=sdk.endpoint, transport=httpx.MockTransport(sdk.respond)) as borrowed:

            def factory(handle: NativeScopeHandle) -> ShellctlClient:
                return ShellctlClient(base_url=sdk.endpoint, token=sdk.auth_token, native_scope=handle, client=borrowed)

            sdk.job_client = factory
            assert (
                await transport.execute_async(language="python3", preload="", code="private")
                == "<<RESULT>>{}<<RESULT>>\n"
            )
            assert not borrowed.is_closed
        assert borrowed.is_closed

    with asyncio.Runner() as runner:
        runner.run(scenario())


def test_async_unknown_persistence_failure_is_redacted_and_still_settles() -> None:
    transport, sdk, durable, lifetime = setup_transport([page(exit_code=1)])

    def reject(identity: NativeCodeIdentity) -> None:
        del identity
        raise ValueError("private persistence outage")

    durable.mark_unknown = reject
    with asyncio.Runner() as runner, pytest.raises(CodeExecutionError, match="^Native code execution unavailable$"):
        runner.run(transport.execute_async(language="python3", preload="", code="private"))
    assert sdk.closed == 1
    assert lifetime.settlements == [False]


@pytest.mark.parametrize("phase", ["close", "settle", "body_then_repeated"])
def test_external_cancellation_waits_for_bounded_ownership_handoff(phase: str) -> None:
    """Event-driven cancellation of the actual adapter lifecycle, never sleeps to race it."""
    transport, sdk, durable, lifetime = setup_transport()
    transport = replace(transport, bounds=replace(transport.bounds, close_seconds=0.04))

    async def scenario() -> None:
        close_entered, close_release = asyncio.Event(), asyncio.Event()
        settle_entered, settle_release = asyncio.Event(), asyncio.Event()
        body_entered = asyncio.Event()
        run_attempts = 0
        closed = False
        original_factory = sdk.job_client

        def factory(handle: NativeScopeHandle) -> ShellctlClient:
            client = original_factory(handle)
            original_close = client.close

            async def close() -> None:
                nonlocal closed
                close_entered.set()
                await close_release.wait()
                await original_close()
                closed = True

            client.close = close
            if phase == "body_then_repeated":

                async def run(*args: object, **kwargs: object) -> None:
                    del args, kwargs
                    nonlocal run_attempts
                    run_attempts += 1
                    body_entered.set()
                    await asyncio.Event().wait()

                client.run = run
            return client

        sdk.job_client = factory

        async def settle(identity: NativeCodeIdentity, *, succeeded: bool) -> None:
            del identity
            lifetime.settlements.append(succeeded)
            settle_entered.set()
            await settle_release.wait()

        lifetime.settle = settle
        loop = asyncio.get_running_loop()
        started = loop.time()
        operation = asyncio.create_task(transport.execute_async(language="python3", preload="", code="private"))
        if phase == "body_then_repeated":
            await asyncio.wait_for(body_entered.wait(), timeout=1)
            operation.cancel("body cancellation")
        await asyncio.wait_for(close_entered.wait(), timeout=1)
        if phase != "settle":
            operation.cancel("close cancellation")
            # Let the cancellation reach the suspended close, then test its
            # boundary state before allowing the successful close to finish.
            checkpoint = asyncio.Event()
            loop.call_soon(checkpoint.set)
            await checkpoint.wait()
            assert not operation.done(), "caller cancellation escaped before ownership handoff"
            close_release.set()
        else:
            close_release.set()
        await asyncio.wait_for(settle_entered.wait(), timeout=1)
        operation.cancel("settlement cancellation")
        checkpoint = asyncio.Event()
        loop.call_soon(checkpoint.set)
        await checkpoint.wait()
        assert not operation.done(), "caller cancellation escaped during settlement"
        assert durable.unknowns >= 1, "cancelled ownership was not persisted as ambiguous"
        settle_release.set()
        first_cancel = (
            "body cancellation"
            if phase == "body_then_repeated"
            else ("settlement cancellation" if phase == "settle" else "close cancellation")
        )
        with pytest.raises(asyncio.CancelledError, match=first_cancel):
            await asyncio.wait_for(operation, timeout=1)
        assert closed
        assert len(lifetime.settlements) == 1
        assert loop.time() - started < 0.5
        assert not [task for task in asyncio.all_tasks() if task is not asyncio.current_task() and not task.done()]
        assert sum(request.url.path.endswith("/run") for request in sdk.requests) <= 1
        assert sum(request.url.path.endswith("/input") for request in sdk.requests) <= 1
        if phase == "body_then_repeated":
            assert run_attempts == 1
            assert not sdk.requests
        else:
            assert sum(request.url.path.endswith("/run") for request in sdk.requests) == 1
            assert sum(request.url.path.endswith("/input") for request in sdk.requests) == 1

    with asyncio.Runner() as runner:
        runner.run(scenario())


@pytest.mark.parametrize("phase", ["close", "settle"])
def test_cancelled_cleanup_keeps_original_deadline_and_leaves_no_task(phase: str) -> None:
    transport, sdk, durable, lifetime = setup_transport()
    budget = 0.03
    transport = replace(transport, bounds=replace(transport.bounds, close_seconds=budget))

    async def scenario() -> None:
        entered, never_release = asyncio.Event(), asyncio.Event()
        original_factory = sdk.job_client

        if phase == "close":

            def factory(handle: NativeScopeHandle) -> ShellctlClient:
                client = original_factory(handle)
                original_close = client.close

                async def close() -> None:
                    await original_close()
                    entered.set()
                    await never_release.wait()

                client.close = close
                return client

            sdk.job_client = factory
        else:

            async def settle(identity: NativeCodeIdentity, *, succeeded: bool) -> None:
                del identity
                lifetime.settlements.append(succeeded)
                entered.set()
                await never_release.wait()

            lifetime.settle = settle
        operation = asyncio.create_task(transport.execute_async(language="python3", preload="", code="private"))
        await asyncio.wait_for(entered.wait(), timeout=1)
        loop = asyncio.get_running_loop()
        started = loop.time()
        operation.cancel("original cleanup cancellation")
        checkpoint = asyncio.Event()
        loop.call_soon(checkpoint.set)
        await checkpoint.wait()
        operation.cancel("repeated cleanup cancellation")
        with pytest.raises(asyncio.CancelledError, match="original cleanup cancellation"):
            await asyncio.wait_for(operation, timeout=1)
        assert loop.time() - started < 2 * budget + 0.1
        assert durable.unknowns >= 1
        assert len(lifetime.settlements) == 1
        assert sdk.closed == 1
        assert not [task for task in asyncio.all_tasks() if task is not asyncio.current_task() and not task.done()]
        assert sum(request.url.path.endswith("/run") for request in sdk.requests) == 1
        assert sum(request.url.path.endswith("/input") for request in sdk.requests) == 1

    with asyncio.Runner() as runner:
        runner.run(scenario())
