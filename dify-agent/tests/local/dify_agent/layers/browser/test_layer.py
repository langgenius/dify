from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
import socket
import threading
import time
from types import SimpleNamespace
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, cast

import pytest
from pydantic_ai.models import Model

from dify_agent.adapters.llm import EmptyResponseRetryModel
from dify_agent.adapters.shell.protocols import ShellCommandResult
from dify_agent.layers.browser import DifyBrowserLayerConfig
from dify_agent.layers.browser import layer as browser_layer
from dify_agent.layers.browser.layer import (
    _BROWSER_FORWARDER_SOURCE,
    _BROWSER_LAUNCHER_HEADER,
    _BROWSER_LAUNCHER_SCRIPT,
    BrowserConcurrencyLimitError,
    BrowserSession,
    Capability,
    State,
    cdp_ws_url,
    parse_cdp_ready,
)
from dify_agent.layers.browser.resilient_model import ResilientPydanticAIChatModel
from dify_agent.runtime.context import BrowserSessionSlots
from dify_agent.runtime_backend import PortEntrypoint, RuntimeLayout, RuntimeLease
from tests.local.dify_agent.module_support import deps_for, invoke_native_tool


def _result(
    job_id: str,
    *,
    status: str = "running",
    done: bool = False,
    exit_code: int | None = None,
    output: str = "",
    offset: int = 0,
    truncated: bool = False,
) -> ShellCommandResult:
    return ShellCommandResult(
        job_id=job_id,
        status=status,
        done=done,
        exit_code=exit_code,
        output=output,
        offset=offset,
        truncated=truncated,
    )


@dataclass(slots=True)
class FakeCommands:
    run_handler: Callable[[str, str | None, dict[str, str] | None, float], ShellCommandResult] | None = None
    wait_handler: Callable[[str, int, float], ShellCommandResult] | None = None
    interrupt_handler: Callable[[str, float], None] | None = None
    run_calls: list[dict[str, Any]] = field(default_factory=list)
    wait_calls: list[dict[str, Any]] = field(default_factory=list)
    interrupt_calls: list[dict[str, Any]] = field(default_factory=list)
    delete_calls: list[dict[str, Any]] = field(default_factory=list)

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
        mode: str = "pty",
    ) -> ShellCommandResult:
        self.run_calls.append({"script": script, "cwd": cwd, "env": env, "timeout": timeout, "mode": mode})
        if self.run_handler is None:
            raise AssertionError("Unexpected run() call")
        return self.run_handler(script, cwd, env, timeout)

    async def wait(self, job_id: str, *, offset: int, timeout: float) -> ShellCommandResult:
        self.wait_calls.append({"job_id": job_id, "offset": offset, "timeout": timeout})
        if self.wait_handler is None:
            raise AssertionError("Unexpected wait() call")
        return self.wait_handler(job_id, offset, timeout)

    async def delete(self, job_id: str, *, force: bool = False, grace_seconds: float | None = None) -> None:
        del grace_seconds
        self.delete_calls.append({"job_id": job_id, "force": force})

    async def interrupt(self, job_id: str, *, grace_seconds: float) -> Any:
        self.interrupt_calls.append({"job_id": job_id, "grace_seconds": grace_seconds})
        if self.interrupt_handler is not None:
            self.interrupt_handler(job_id, grace_seconds)
        return None


@dataclass(slots=True)
class FakeLease:
    commands: FakeCommands
    layout: RuntimeLayout = field(
        default_factory=lambda: RuntimeLayout(
            home_dir="/home/agent-1",
            workspace_dir="/home/agent-1/workspace",
        )
    )
    host: str = "sandbox-1"

    def port_entrypoint(self, port: int) -> PortEntrypoint:
        return PortEntrypoint(base_url=f"http://{self.host}:{port}")


@dataclass(frozen=True)
class RunCtx:
    """The run-context fields the browser capability reads around one run."""

    deps: Any


class FakeHarnessToolset:
    def __init__(self, result: str = "Example Domain"):
        self.result = result
        self.tasks: list[str] = []

    async def browse_web(self, task: str) -> str:
        self.tasks.append(task)
        return self.result


class FakeHarness:
    def __init__(self) -> None:
        self.toolset = FakeHarnessToolset()
        self.closed = False

    def get_toolset(self) -> FakeHarnessToolset:
        return self.toolset

    async def aclose(self) -> None:
        self.closed = True


# ---------------------------------------------------------------------------
# Pure parsing
# ---------------------------------------------------------------------------


def test_parse_cdp_ready_extracts_forwarder_port_and_path() -> None:
    output = "\n".join(
        [
            "[0101/000000.000:INFO] chromium startup noise",
            "DevTools listening on ws://127.0.0.1:39521/devtools/browser/deadbeef",
            "CDP_READY ws://0.0.0.0:46321/devtools/browser/deadbeef",
            "trailing noise",
        ]
    )

    assert parse_cdp_ready(output) == (46321, "/devtools/browser/deadbeef")


def test_parse_cdp_ready_ignores_other_lines() -> None:
    assert parse_cdp_ready("") is None
    assert parse_cdp_ready("DevTools listening on ws://127.0.0.1:1/devtools/browser/x") is None
    assert parse_cdp_ready("CDP_READY ws://127.0.0.1:46321/devtools/browser/x") is None
    assert parse_cdp_ready("CDP_READY ws://0.0.0.0:46321") is None


def test_cdp_ws_url_maps_scheme_to_websocket() -> None:
    http = PortEntrypoint(base_url="http://sandbox-1:46321")
    assert cdp_ws_url(http, "/devtools/browser/x") == "ws://sandbox-1:46321/devtools/browser/x"
    https = PortEntrypoint(base_url="https://49983-demo.e2b.dev")
    assert cdp_ws_url(https, "/devtools/browser/x") == "wss://49983-demo.e2b.dev/devtools/browser/x"
    with pytest.raises(ValueError, match="http"):
        cdp_ws_url(PortEntrypoint(base_url="ftp://nope"), "/x")


def test_capability_exposes_harness_delegation_guidance() -> None:
    instructions = Capability("browser").get_instructions()

    assert isinstance(instructions, str)
    assert "browse_web" in instructions
    assert "untrusted" in instructions


# ---------------------------------------------------------------------------
# browse_web tool
# ---------------------------------------------------------------------------


def test_browse_web_tool_delegates_task_to_harness_toolset() -> None:
    deps = deps_for("browser", DifyBrowserLayerConfig(), State().model_dump(mode="json"))
    toolset = FakeHarnessToolset(result="Example Domain")
    deps.resources.browsers["browser"] = BrowserSession(
        name="browser",
        job_id="job-1",
        harness=FakeHarness(),  # pyright: ignore[reportArgumentType]
        harness_toolset=toolset,  # pyright: ignore[reportArgumentType]
        ws_url="ws://sandbox-1:46321/devtools/browser/deadbeef",
    )

    async def scenario() -> object:
        return await invoke_native_tool(
            deps,
            Capability("browser").get_toolset(),
            "browse_web",
            {"task": "Find the title of example.com"},
        )

    result = asyncio.run(scenario())

    assert toolset.tasks == ["Find the title of example.com"]
    assert "Example Domain" in str(result)


def test_browse_web_tool_requires_active_session() -> None:
    deps = deps_for("browser", DifyBrowserLayerConfig(), State().model_dump(mode="json"))

    async def scenario() -> None:
        with pytest.raises(RuntimeError, match="not available"):
            await invoke_native_tool(
                deps,
                Capability("browser").get_toolset(),
                "browse_web",
                {"task": "find something"},
            )

    asyncio.run(scenario())


# ---------------------------------------------------------------------------
# sub-agent model hardening
# ---------------------------------------------------------------------------


def test_build_harness_hardens_thinking_only_sub_agent_responses() -> None:
    class _StubModel(Model):
        @property
        def model_name(self) -> str:
            return "stub-model"

        @property
        def system(self) -> str:
            return "stub"

        async def request(self, messages: Any, model_settings: Any, model_request_parameters: Any) -> Any:
            raise AssertionError("stub model must not be called")

    inner = _StubModel()
    ctx = SimpleNamespace(model=inner)
    harness = browser_layer._build_harness(ctx, browser_layer.Config(), ws_url="ws://127.0.0.1:9222/devtools")

    # The sub-agent model is resampled at the model boundary and its inner
    # agent gets an output retry budget, so a burst of thinking-only draws
    # cannot consume browser-use's per-step failure budget.
    assert isinstance(harness.llm, ResilientPydanticAIChatModel)
    resampler = harness.llm._model
    assert isinstance(resampler, EmptyResponseRetryModel)
    assert resampler.wrapped is inner


# ---------------------------------------------------------------------------
# wrap_run lifecycle
# ---------------------------------------------------------------------------


_READY_OUTPUT = (
    "DevTools listening on ws://127.0.0.1:39521/devtools/browser/deadbeef\n"
    "CDP_READY ws://0.0.0.0:46321/devtools/browser/deadbeef\n"
)


def _wrap_run_fixture(
    monkeypatch: pytest.MonkeyPatch,
    *,
    commands: FakeCommands,
    config: DifyBrowserLayerConfig | None = None,
) -> tuple[Capability, Any, FakeLease, FakeHarness, list[dict[str, Any]]]:
    lease = FakeLease(commands=commands)
    deps = deps_for("browser", config or DifyBrowserLayerConfig(), State().model_dump(mode="json"))
    deps.resources.leases["runtime"] = cast(RuntimeLease, lease)
    harness = FakeHarness()
    built: list[dict[str, Any]] = []

    def fake_build_harness(ctx: Any, cfg: Any, *, ws_url: str) -> FakeHarness:
        built.append({"ws_url": ws_url, "config": cfg})
        return harness

    monkeypatch.setattr(browser_layer, "_build_harness", fake_build_harness)

    async def fake_cdp(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        if method == "Target.getTargets":
            return {"targetInfos": [{"targetId": "p0", "type": "page", "url": "about:blank"}]}
        return {}

    async def fake_watchdog(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(browser_layer, "_cdp_command", fake_cdp)
    monkeypatch.setattr(browser_layer, "_jar_watchdog", fake_watchdog)
    return Capability("browser"), deps, lease, harness, built


def test_wrap_run_launches_launcher_and_attaches_over_cdp(monkeypatch: pytest.MonkeyPatch) -> None:
    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _result("job-1", output=_READY_OUTPUT, offset=len(_READY_OUTPUT))
    )
    capability, deps, _lease, harness, built = _wrap_run_fixture(monkeypatch, commands=commands)
    seen: dict[str, Any] = {}

    async def handler() -> str:
        seen["session"] = deps.resources.browsers.get("browser")
        return "run-done"

    async def scenario() -> object:
        return await capability.wrap_run(RunCtx(deps=deps), handler=handler)

    assert asyncio.run(scenario()) == "run-done"

    run_call = commands.run_calls[0]
    assert run_call["script"].startswith("#!/usr/bin/env python3")
    assert run_call["cwd"] == "/home/agent-1/workspace"
    assert run_call["mode"] == "stdio"
    assert run_call["env"]["HOME"] == "/home/agent-1"
    profile_dir = run_call["env"]["BROWSER_PROFILE_DIR"]
    assert profile_dir.startswith("/home/agent-1/.browser/")
    # Per-job config root: this Chromium build keeps its process singleton
    # in $XDG_CONFIG_HOME, so concurrent sessions of one agent must not
    # share it.
    assert run_call["env"]["XDG_CONFIG_HOME"] == f"{profile_dir}/config"
    assert built == [
        {
            "ws_url": "ws://sandbox-1:46321/devtools/browser/deadbeef",
            "config": browser_layer.Config.model_validate(deps.layers["browser"]["config"]),
        }
    ]
    assert seen["session"] is not None
    assert seen["session"].job_id == "job-1"
    assert deps.resources.browsers == {}
    assert commands.delete_calls == [{"job_id": "job-1", "force": True}]
    assert harness.closed is True
    assert commands.wait_calls == []


def test_wrap_run_polls_until_cdp_ready_advancing_offsets(monkeypatch: pytest.MonkeyPatch) -> None:
    # run delivers outputs[0]; wait N (index i) must be called at offsets[i]
    # and returns outputs[i + 1].
    outputs = ["partial\n", "more\n", "CDP_READY ws://0.0.0.0:46321/devtools/browser/deadbeef\n"]
    offsets = [8, 14, 60]
    cursor = {"index": 0}

    def wait_handler(job_id: str, offset: int, timeout: float) -> ShellCommandResult:
        del timeout
        assert job_id == "job-1"
        assert offset == offsets[cursor["index"]]
        index = cursor["index"]
        cursor["index"] += 1
        return _result("job-1", output=outputs[index + 1], offset=offsets[index + 1])

    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _result("job-1", output=outputs[0], offset=offsets[0]),
        wait_handler=wait_handler,
    )
    capability, deps, _lease, _harness, built = _wrap_run_fixture(monkeypatch, commands=commands)

    async def scenario() -> object:
        return await capability.wrap_run(RunCtx(deps=deps), handler=lambda: asyncio.sleep(0))

    asyncio.run(scenario())

    assert built[0]["ws_url"] == "ws://sandbox-1:46321/devtools/browser/deadbeef"
    assert [call["offset"] for call in commands.wait_calls] == offsets[:2]
    assert commands.delete_calls == [{"job_id": "job-1", "force": True}]


def test_wrap_run_deletes_job_when_launcher_exits_before_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _result(
            "job-1", status="exited", done=True, exit_code=127, output="chromium: not found\n", offset=22
        )
    )
    capability, deps, _lease, _harness, built = _wrap_run_fixture(monkeypatch, commands=commands)

    async def handler() -> str:
        raise AssertionError("handler must not run when the launcher failed")

    async def scenario() -> None:
        with pytest.raises(RuntimeError, match="exited before CDP was ready"):
            await capability.wrap_run(RunCtx(deps=deps), handler=handler)

    asyncio.run(scenario())

    assert built == []
    assert deps.resources.browsers == {}
    assert commands.delete_calls == [{"job_id": "job-1", "force": True}]


def test_wrap_run_times_out_waiting_for_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _result("job-1", output="starting\n", offset=9),
        wait_handler=lambda job_id, offset, timeout: _result(job_id, output="still starting\n", offset=offset + 9),
    )
    capability, deps, _lease, _harness, built = _wrap_run_fixture(monkeypatch, commands=commands)
    monkeypatch.setattr(browser_layer, "_READY_MAX_WAIT_SECONDS", 0.05)

    async def scenario() -> None:
        with pytest.raises(RuntimeError, match="Timed out waiting for the browser launcher"):
            await capability.wrap_run(RunCtx(deps=deps), handler=lambda: asyncio.sleep(0))

    asyncio.run(scenario())

    assert built == []
    assert deps.resources.browsers == {}
    assert commands.delete_calls == [{"job_id": "job-1", "force": True}]
    assert commands.wait_calls, "the poll loop must have issued at least one wait"


def test_wrap_run_requires_active_runtime_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    capability, deps, _lease, _harness, _built = _wrap_run_fixture(monkeypatch, commands=FakeCommands())
    deps.resources.leases.clear()

    async def scenario() -> None:
        with pytest.raises(RuntimeError, match="active Runtime lease"):
            await capability.wrap_run(RunCtx(deps=deps), handler=lambda: asyncio.sleep(0))

    asyncio.run(scenario())


def test_wrap_run_survives_harness_close_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom() -> None:
        raise RuntimeError("harness close failed")

    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _result("job-1", output=_READY_OUTPUT, offset=40)
    )
    capability, deps, _lease, harness, _built = _wrap_run_fixture(monkeypatch, commands=commands)
    harness.aclose = boom  # type: ignore[method-assign]

    async def scenario() -> object:
        return await capability.wrap_run(RunCtx(deps=deps), handler=lambda: asyncio.sleep(0))

    assert asyncio.run(scenario()) is None
    assert commands.delete_calls == [{"job_id": "job-1", "force": True}]
    assert deps.resources.browsers == {}


def _forwarder_namespace() -> dict[str, Any]:
    namespace: dict[str, Any] = {}
    source = _BROWSER_LAUNCHER_HEADER + _BROWSER_FORWARDER_SOURCE
    exec(compile(source, "cdp-forwarder", "exec"), namespace)  # noqa: S102 - trusted static source
    return namespace


class _ChunkedReader:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = list(chunks)

    async def read(self, _size: int) -> bytes:
        return self._chunks.pop(0) if self._chunks else b""


class _RecordingWriter:
    def __init__(self) -> None:
        self.written: list[bytes] = []
        self.closed = False

    def write(self, data: bytes) -> None:
        self.written.append(data)

    async def drain(self) -> None:
        return None

    def close(self) -> None:
        self.closed = True


def test_forwarder_rewrite_host_replaces_remote_host() -> None:
    namespace = _forwarder_namespace()
    header = b"GET /json/version HTTP/1.1\r\nHost: 10.1.2.3:9999\r\nAccept: */*\r\n"
    assert namespace["_rewrite_host"](header) == (b"GET /json/version HTTP/1.1\r\nHost: localhost\r\nAccept: */*\r\n")


def test_forwarder_pump_single_chunk_request_keeps_one_delimiter() -> None:
    namespace = _forwarder_namespace()
    writer = _RecordingWriter()

    async def scenario() -> None:
        reader = _ChunkedReader([b"GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:43859\r\nConnection: close\r\n\r\n"])
        await namespace["_pump"](reader, writer, rewrite=True)

    asyncio.run(scenario())
    upstream = b"".join(writer.written)
    assert upstream == b"GET /json/version HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
    assert upstream.count(b"\r\n\r\n") == 1


def test_forwarder_pump_header_split_across_chunks() -> None:
    namespace = _forwarder_namespace()
    writer = _RecordingWriter()

    async def scenario() -> None:
        reader = _ChunkedReader([b"GET /x HTTP/1.1\r\nHos", b"t: remote:1\r\n\r\nBODY-1", b"BODY-2"])
        await namespace["_pump"](reader, writer, rewrite=True)

    asyncio.run(scenario())
    upstream = b"".join(writer.written)
    assert upstream == b"GET /x HTTP/1.1\r\nHost: localhost\r\n\r\nBODY-1BODY-2"


def test_forwarder_pump_plain_mode_forwards_bytes_unchanged() -> None:
    namespace = _forwarder_namespace()
    writer = _RecordingWriter()

    async def scenario() -> None:
        reader = _ChunkedReader([b"chunk-1", b"chunk-2"])
        await namespace["_pump"](reader, writer, rewrite=False)

    asyncio.run(scenario())
    assert b"".join(writer.written) == b"chunk-1chunk-2"


def test_forwarder_proxy_closes_client_when_upstream_is_down(monkeypatch: pytest.MonkeyPatch) -> None:
    namespace = _forwarder_namespace()

    async def _refused(*_args: Any, **_kwargs: Any) -> tuple[Any, Any]:
        raise ConnectionRefusedError("upstream is down")

    monkeypatch.setattr(asyncio, "open_connection", _refused)
    client_writer = _RecordingWriter()

    async def scenario() -> None:
        reader = _ChunkedReader([])
        await namespace["_proxy_connection"](reader, client_writer, 9)

    asyncio.run(scenario())
    assert client_writer.closed is True


# ---------------------------------------------------------------------------
# CDP client (login state load/save, agent-backend side)
# ---------------------------------------------------------------------------


def _cdp_client_namespace() -> dict[str, Any]:
    return {
        "_encode_text_frame": browser_layer._encode_text_frame,
        "_read_frame": browser_layer._read_frame,
        "_state_to_cdp_cookies": browser_layer._state_to_cdp_cookies,
        "_cdp_to_state": browser_layer._cdp_to_state,
        "_load_state_file": browser_layer._load_state_file,
        "_load_state_file_dict": browser_layer._load_state_file_dict,
        "_cdp_command": browser_layer._cdp_command,
    }


def test_launcher_script_is_self_containing() -> None:
    """The job runs the script verbatim in the sandbox: every name it loads
    must be defined, imported, or assigned inside the script itself."""
    import ast as ast_module
    import builtins as builtins_module

    script = _BROWSER_LAUNCHER_SCRIPT
    tree = ast_module.parse(script)
    defined = {
        node.name
        for node in ast_module.walk(tree)
        if isinstance(node, (ast_module.FunctionDef, ast_module.AsyncFunctionDef))
    }
    imported = set()
    assigned = set()
    loaded = set()
    for node in ast_module.walk(tree):
        if isinstance(node, ast_module.Import):
            imported.update(alias.asname or alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast_module.ImportFrom):
            imported.update(alias.asname or alias.name for alias in node.names)
        elif isinstance(node, ast_module.Name):
            if isinstance(node.ctx, ast_module.Store):
                assigned.add(node.id)
            elif isinstance(node.ctx, ast_module.Load):
                loaded.add(node.id)
        elif isinstance(node, (ast_module.FunctionDef, ast_module.AsyncFunctionDef, ast_module.Lambda)):
            args = node.args
            for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
                assigned.add(arg.arg)
            if args.vararg is not None:
                assigned.add(args.vararg.arg)
            if args.kwarg is not None:
                assigned.add(args.kwarg.arg)
        elif isinstance(node, ast_module.withitem):
            if node.optional_vars is not None:
                for target in ast_module.walk(node.optional_vars):
                    if isinstance(target, ast_module.Name):
                        assigned.add(target.id)
        elif isinstance(node, ast_module.ExceptHandler):
            if node.name is not None:
                assigned.add(node.name)
    missing = loaded - defined - imported - assigned - set(dir(builtins_module))
    assert not missing, f"launcher references undefined names: {sorted(missing)}"


def test_launcher_starts_forwarder_inside_devtools_match() -> None:
    """The forwarder + CDP_READY must start exactly once, on the DevTools
    line -- regardless of whether a login-state file exists."""
    import ast as ast_module

    tree = ast_module.parse(_BROWSER_LAUNCHER_SCRIPT)
    match_blocks = []
    for node in ast_module.walk(tree):
        if isinstance(node, ast_module.If):
            test_src = ast_module.unparse(node.test)
            if test_src.strip() == "match":
                match_blocks.append(node)
    assert match_blocks, "launcher must keep the DevTools match guard"
    inside = {id(n) for block in match_blocks for n in ast_module.walk(block)}
    for node in ast_module.walk(tree):
        if isinstance(node, ast_module.AsyncFunctionDef) and node.name == "main":
            for assign in ast_module.walk(node):
                if not isinstance(assign, ast_module.Assign):
                    continue
                for target in assign.targets:
                    if isinstance(target, ast_module.Name) and target.id == "server" and id(assign) in inside:
                        value = ast_module.unparse(assign.value)
                        if "start_server" in value:
                            return
    pytest.fail("launcher starts the CDP forwarder outside the DevTools match block")


class _BufferedSock:
    """In-memory socket stand-in so frame tests never block on buffers."""

    def __init__(self, data: bytes) -> None:
        self._data = data

    def recv(self, size: int) -> bytes:
        chunk, self._data = self._data[:size], self._data[size:]
        return chunk


def test_cdp_encode_text_frame_is_rfc6455_masked() -> None:
    namespace = _cdp_client_namespace()

    # Short payload: 7-bit length, one masked block.
    frame = namespace["_encode_text_frame"](b"hello cdp")
    assert frame[0] == 0x81
    assert frame[1] & 0x80, "client frames must be masked"
    assert frame[1] & 0x7F == len(b"hello cdp")
    mask = frame[2:6]
    masked = frame[6:]
    assert bytes(b ^ mask[i % 4] for i, b in enumerate(masked)) == b"hello cdp"

    # 16-bit extended length.
    mid = b"y" * 300
    raw = namespace["_encode_text_frame"](mid)
    assert raw[0] == 0x81
    assert raw[1] & 0x80
    assert (raw[1] & 0x7F) == 126
    assert int.from_bytes(raw[2:4], "big") == 300
    mask = raw[4:8]
    masked = raw[8:]
    assert bytes(b ^ mask[i % 4] for i, b in enumerate(masked)) == mid

    # 64-bit extended length.
    big = b"x" * 70000
    raw = namespace["_encode_text_frame"](big)
    assert raw[0] == 0x81
    assert raw[1] & 0x80
    assert (raw[1] & 0x7F) == 127
    assert int.from_bytes(raw[2:10], "big") == len(big)
    mask = raw[10:14]
    masked = raw[14:]
    assert bytes(b ^ mask[i % 4] for i, b in enumerate(masked)) == big


def test_cdp_read_frame_parses_unmasked_server_frames() -> None:
    namespace = _cdp_client_namespace()

    # 7-bit length.
    payload, opcode, leftover = namespace["_read_frame"](_BufferedSock(b"\x81" + bytes([5]) + b"world"), b"")
    assert payload == b"world"
    assert opcode == 0x1
    assert leftover == b""

    # 16-bit length.
    mid = b"m" * 300
    payload, opcode, leftover = namespace["_read_frame"](
        _BufferedSock(b"\x81" + b"\x7e" + (300).to_bytes(2, "big") + mid), b""
    )
    assert payload == mid
    assert leftover == b""

    # 64-bit length, arriving across several reads.
    big = b"b" * 70000
    payload, opcode, leftover = namespace["_read_frame"](
        _BufferedSock(b"\x81" + b"\x7f" + (70000).to_bytes(8, "big") + big), b""
    )
    assert payload == big
    assert leftover == b""


def test_cdp_state_cookie_conversion() -> None:
    namespace = _cdp_client_namespace()
    state = {
        "cookies": [
            {
                "name": "token",
                "value": "abc",
                "domain": ".example.com",
                "path": "/",
                "expires": 1799999999.0,
                "httpOnly": True,
                "secure": True,
                "sameSite": "Lax",
            }
        ],
        "origins": [],
    }
    cdp_cookies = namespace["_state_to_cdp_cookies"](state)
    assert cdp_cookies[0]["expires"] == 1799999999.0
    assert cdp_cookies[0]["sameSite"] == "Lax"
    back = namespace["_cdp_to_state"](cdp_cookies)
    assert back["cookies"][0]["value"] == "abc"
    assert back["origins"] == []
    # Session cookies (expires <= 0) omit 'expires' for CDP.
    session_cdp = namespace["_state_to_cdp_cookies"](
        {"cookies": [{"name": "s", "value": "1", "domain": "d", "path": "/", "expires": -1}]}
    )
    assert "expires" not in session_cdp[0]


def _fake_target_cdp(targets: list[dict], calls: list[tuple]) -> Any:
    def fake(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> Any:
        calls.append((method, dict(params)))
        if method == "Target.getTargets":
            return {"targetInfos": list(targets)}
        if method == "Target.closeTarget":
            targets[:] = [t for t in targets if t.get("targetId") != params.get("targetId")]
            return {}
        if method == "Target.createTarget":
            targets.append({"targetId": f"t{len(targets)}", "type": "page", "url": params.get("url", "")})
            return {"targetId": targets[-1]["targetId"]}
        raise AssertionError(f"unexpected CDP method: {method}")

    async def _fake(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> Any:
        return fake(ws_url, method, params, timeout)

    return _fake


def _run_prepare(monkeypatch: pytest.MonkeyPatch, targets: list[dict], calls: list[tuple]) -> None:
    monkeypatch.setattr(browser_layer, "_cdp_command", _fake_target_cdp(targets, calls))
    asyncio.run(browser_layer._prepare_page_targets("ws://x"))


def test_prepare_page_targets_replaces_launch_tab_with_about_blank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    targets: list[dict] = [
        {"targetId": "a", "type": "page", "url": "file:///home/agent/.browser/xyz/"},
        {"targetId": "b", "type": "browser_ui", "url": "chrome://omnibox/"},
    ]
    calls: list[tuple] = []
    _run_prepare(monkeypatch, targets, calls)
    assert all(t.get("url") != "file:///home/agent/.browser/xyz/" for t in targets)
    pages = [t for t in targets if t.get("type") == "page"]
    assert [t["url"] for t in pages] == ["about:blank"]
    closed = [c for c in calls if c[0] == "Target.closeTarget"]
    assert closed == [("Target.closeTarget", {"targetId": "a"})]


def test_prepare_page_targets_keeps_existing_web_tab(monkeypatch: pytest.MonkeyPatch) -> None:
    targets: list[dict] = [{"targetId": "a", "type": "page", "url": "https://example.com/"}]
    calls: list[tuple] = []
    _run_prepare(monkeypatch, targets, calls)
    assert calls == [("Target.getTargets", {}), ("Target.getTargets", {})]
    assert targets == [{"targetId": "a", "type": "page", "url": "https://example.com/"}]


def test_prepare_page_targets_creates_tab_when_only_non_pages_exist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    targets: list[dict] = [{"targetId": "b", "type": "browser_ui", "url": "chrome://omnibox/"}]
    calls: list[tuple] = []
    _run_prepare(monkeypatch, targets, calls)
    pages = [t for t in targets if t.get("type") == "page"]
    assert [t["url"] for t in pages] == ["about:blank"]
    assert ("Target.createTarget", {"url": "about:blank"}) in calls


class _SandboxStateFs:
    """In-memory stand-in for the sandbox home for the state-file jobs.

    Emulates the two job scripts the capability issues: ``base64 <path>``
    reads, and the base64-pipe write with a tmp-file rename.
    """

    def __init__(self, files: dict[str, bytes] | None = None) -> None:
        self.files: dict[str, bytes] = dict(files or {})
        self.commands = FakeCommands(run_handler=self._run)

    def _run(self, script: str, cwd: Any, env: Any, timeout: float) -> ShellCommandResult:
        if script.startswith("base64 "):
            tokens = script.split()
            pos = 1
            while tokens[pos] in ("-w", "0"):
                pos += 1
            data = self.files.get(tokens[pos])
            if data is None:
                return _result("job-fs", status="exited", done=True, exit_code=1, output="")
            return _result("job-fs", status="exited", done=True, exit_code=0, output=base64.b64encode(data).decode())
        encoded = re.search(r"printf %s (\S+) \| base64 -d", script)
        dest = re.search(r'mv "\$tmp" (\S+)', script)
        assert encoded is not None and dest is not None, f"unexpected script: {script!r}"
        self.files[dest.group(1)] = base64.b64decode(encoded.group(1))
        return _result("job-fs", status="exited", done=True, exit_code=0)


def test_state_file_round_trips_through_sandbox_jobs() -> None:
    path = "/home/agent-1/.browser-state.json"
    state = {"cookies": [{"name": "t", "value": "v", "domain": "d", "path": "/"}], "origins": []}
    fs = _SandboxStateFs()

    assert asyncio.run(browser_layer._load_state_file_sandbox(fs.commands, path)) is None
    asyncio.run(browser_layer._persist_state_file(fs.commands, path, state))
    assert asyncio.run(browser_layer._load_state_file_sandbox(fs.commands, path)) == state

    write_scripts = [call["script"] for call in fs.commands.run_calls if call["script"].startswith("set -eu")]
    assert len(write_scripts) == 1
    assert "base64 -d" in write_scripts[0] and "chmod 600" in write_scripts[0], (
        "cookie state must land in the sandbox 0600"
    )


def test_state_file_load_rejects_corrupt_or_missing(tmp_path: Any) -> None:
    namespace = _cdp_client_namespace()
    path = str(tmp_path / "state.json")
    (tmp_path / "state.json").write_text('{"cookies": [{"name": "t"}]}', encoding="utf-8")
    assert namespace["_load_state_file"](path)["cookies"][0]["name"] == "t"
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")
    assert namespace["_load_state_file"](str(tmp_path / "bad.json")) is None
    assert namespace["_load_state_file"](str(tmp_path / "missing.json")) is None
    assert namespace["_load_state_file_dict"]({"cookies": "nope"}) is None


def _mini_cdp_server() -> tuple[socket.socket, list[dict[str, Any]]]:
    """A single-shot DevTools-style websocket server answering Storage.getCookies."""
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    seen: list[dict[str, Any]] = []

    def serve_one() -> None:
        conn, _ = server.accept()
        data = b""
        while b"\r\n\r\n" not in data:
            data += conn.recv(65536)
        key = (
            [line for line in data.split(b"\r\n") if line.lower().startswith(b"sec-websocket-key")][0]
            .split(b":", 1)[1]
            .strip()
        )
        accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest()).decode()
        conn.sendall(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode()
        )
        header = b""
        while len(header) < 2:
            header += conn.recv(1)
        length = header[1] & 0x7F
        if length == 126:
            ext = b""
            while len(ext) < 2:
                ext += conn.recv(1)
            length = int.from_bytes(ext, "big")
        mask = b""
        while len(mask) < 4:
            mask += conn.recv(1)
        payload = b""
        while len(payload) < length:
            payload += conn.recv(length - len(payload))
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        seen.append(json.loads(payload))
        reply = json.dumps(
            {
                "id": 1,
                "result": {
                    "cookies": [
                        {
                            "name": "token",
                            "value": "abc",
                            "domain": ".example.com",
                            "path": "/",
                            "expires": 1799999999.0,
                            "httpOnly": True,
                            "secure": False,
                            "sameSite": "Lax",
                        }
                    ]
                },
            }
        ).encode()
        frame = b"\x81"
        if len(reply) < 126:
            frame += bytes([len(reply)])
        else:
            frame += b"\x7e" + len(reply).to_bytes(2, "big")
        conn.sendall(frame + reply)
        conn.close()

    threading.Thread(target=serve_one, daemon=True).start()
    return server, seen


def test_cdp_command_completes_a_real_websocket_exchange() -> None:
    namespace = _cdp_client_namespace()
    server, seen = _mini_cdp_server()
    port = server.getsockname()[1]
    try:
        result = asyncio.run(
            namespace["_cdp_command"](
                f"ws://127.0.0.1:{port}/devtools/browser/deadbeef",
                "Storage.getCookies",
                {},
            )
        )
    finally:
        server.close()
    assert result["cookies"][0]["name"] == "token"
    assert seen[0]["method"] == "Storage.getCookies"
    assert seen[0]["id"] == 1


# ---------------------------------------------------------------------------
# Login state persistence and concurrency slots
# ---------------------------------------------------------------------------


def _run_handler_with_state_fs(state_bytes: bytes | None, launcher_output: str = _READY_OUTPUT):
    fs = _SandboxStateFs({"/home/agent-1/.browser-state.json": state_bytes} if state_bytes else {})

    def run(script: str, cwd: Any, env: Any, timeout: float) -> ShellCommandResult:
        if script.startswith("#!"):
            return _result("job-1", output=launcher_output, offset=len(launcher_output))
        return fs._run(script, cwd, env, timeout)

    return FakeCommands(run_handler=run), fs


def _fake_cdp_command(monkeypatch: pytest.MonkeyPatch, cookies: list[dict[str, Any]]):
    calls: list[dict[str, Any]] = []

    async def fake(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        calls.append({"ws_url": ws_url, "method": method, "params": params})
        if method == "Target.getTargets":
            return {"targetInfos": [{"targetId": "p0", "type": "page", "url": "about:blank"}]}
        return {"cookies": cookies}

    monkeypatch.setattr(browser_layer, "_cdp_command", fake)
    return calls


def test_wrap_run_persist_login_state_loads_then_saves_via_cdp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved_state = {"cookies": [{"name": "token", "value": "p3", "domain": "httpbin.org", "path": "/"}], "origins": []}
    commands, fs = _run_handler_with_state_fs(json.dumps(saved_state).encode("utf-8"))
    config = DifyBrowserLayerConfig(persist_login_state=True)
    capability, deps, _lease, _harness, _built = _wrap_run_fixture(monkeypatch, commands=commands, config=config)
    cdp_calls = _fake_cdp_command(monkeypatch, cookies=saved_state["cookies"])
    seen: dict[str, Any] = {}

    async def handler() -> str:
        seen["session"] = deps.resources.browsers.get("browser")
        return "run-done"

    async def scenario() -> object:
        return await capability.wrap_run(RunCtx(deps=deps), handler=handler)

    assert asyncio.run(scenario()) == "run-done"

    env = commands.run_calls[0]["env"]
    assert "BROWSER_STATE_FILE" not in env, "the launcher no longer touches state"
    session = seen["session"]
    assert session.state_file == "/home/agent-1/.browser-state.json"
    assert session.ws_url.startswith("ws://sandbox-1:")

    methods = [call["method"] for call in cdp_calls]
    assert methods == [
        "Target.getTargets",
        "Target.getTargets",
        "Storage.setCookies",
        "Storage.getCookies",
    ], "state must load before the harness attaches and dump before teardown"
    set_cookies = next(c for c in cdp_calls if c["method"] == "Storage.setCookies")
    assert set_cookies["params"]["cookies"][0]["name"] == "token"
    # The dump is written into the sandbox home, replacing the loaded state.
    reread = asyncio.run(browser_layer._load_state_file_sandbox(commands, session.state_file))
    assert reread == browser_layer._cdp_to_state(saved_state["cookies"])
    write_scripts = [call["script"] for call in commands.run_calls if call["script"].startswith("set -eu")]
    assert len(write_scripts) == 1 and "chmod 600" in write_scripts[0]
    assert commands.interrupt_calls == [{"job_id": "job-1", "grace_seconds": browser_layer._STATE_FLUSH_GRACE_SECONDS}]
    assert commands.delete_calls == [{"job_id": "job-1", "force": True}]


def test_wrap_run_persist_without_saved_state_skips_load(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commands, _fs = _run_handler_with_state_fs(None)
    config = DifyBrowserLayerConfig(persist_login_state=True)
    capability, deps, _lease, _harness, _built = _wrap_run_fixture(monkeypatch, commands=commands, config=config)
    cdp_calls = _fake_cdp_command(monkeypatch, cookies=[])

    async def scenario() -> object:
        return await capability.wrap_run(RunCtx(deps=deps), handler=lambda: asyncio.sleep(0))

    asyncio.run(scenario())

    methods = [call["method"] for call in cdp_calls]
    assert methods == ["Target.getTargets", "Target.getTargets", "Storage.getCookies"], (
        "no saved state -> load skipped, dump still runs"
    )


# ---------------------------------------------------------------------------
# Jar watchdog: mid-run wipe (last tab closed) recovery
# ---------------------------------------------------------------------------


def test_refresh_jar_cache_keeps_latest_non_empty_jar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fresh = [{"name": "login", "value": "new", "domain": "d", "path": "/"}]
    session = SimpleNamespace(name="browser", jar_cache=[{"name": "stale", "value": "old"}])

    async def cdp(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        if method == "Storage.getCookies":
            return {"cookies": list(fresh)}
        raise AssertionError(f"unexpected CDP method: {method}")

    monkeypatch.setattr(browser_layer, "_cdp_command", cdp)
    asyncio.run(browser_layer._refresh_jar_cache("ws://x", session))
    assert session.jar_cache == fresh


def test_refresh_jar_cache_keeps_snapshot_on_empty_jar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = SimpleNamespace(name="browser", jar_cache=[{"name": "token", "value": "v"}])

    async def cdp(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        return {"cookies": []}

    monkeypatch.setattr(browser_layer, "_cdp_command", cdp)
    asyncio.run(browser_layer._refresh_jar_cache("ws://x", session))
    assert session.jar_cache == [{"name": "token", "value": "v"}]


def _read_client_frame(conn: socket.socket) -> bytes:
    header = b""
    while len(header) < 2:
        header += conn.recv(1)
    length = header[1] & 0x7F
    if length == 126:
        ext = b""
        while len(ext) < 2:
            ext += conn.recv(1)
        length = int.from_bytes(ext, "big")
    elif length == 127:
        ext = b""
        while len(ext) < 8:
            ext += conn.recv(1)
        length = int.from_bytes(ext, "big")
    mask = b""
    while len(mask) < 4:
        mask += conn.recv(1)
    payload = b""
    while len(payload) < length:
        payload += conn.recv(length - len(payload))
    return bytes(b ^ mask[i % 4] for i, b in enumerate(payload))


def _server_text_frame(body: bytes) -> bytes:
    frame = b"\x81"
    if len(body) < 126:
        frame += bytes([len(body)])
    elif len(body) < 65536:
        frame += b"\x7e" + len(body).to_bytes(2, "big")
    else:
        frame += b"\x7f" + len(body).to_bytes(8, "big")
    return frame + body


def _ws_event_server(event: dict[str, Any]) -> tuple[socket.socket, list[dict[str, Any]]]:
    """DevTools-style websocket server: handshakes, answers the first client
    frame by sending one scripted CDP event, then idles."""
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    seen: list[dict[str, Any]] = []

    def serve_one() -> None:
        conn, _ = server.accept()
        try:
            data = b""
            while b"\r\n\r\n" not in data:
                data += conn.recv(65536)
            key = (
                [line for line in data.split(b"\r\n") if line.lower().startswith(b"sec-websocket-key")][0]
                .split(b":", 1)[1]
                .strip()
            )
            accept = base64.b64encode(hashlib.sha1(key + b"").digest()).decode()
            conn.sendall(
                (
                    "HTTP/1.1 101 Switching Protocols\r\n"
                    "Upgrade: websocket\r\n"
                    "Connection: Upgrade\r\n"
                    f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
                ).encode()
            )
            first = _read_client_frame(conn)
            seen.append(json.loads(first))
            conn.sendall(_server_text_frame(json.dumps(event).encode()))
            while True:
                if not conn.recv(1):
                    break
        except OSError:
            pass

    threading.Thread(target=serve_one, daemon=True).start()
    return server, seen


def _destroyed_event(target_id: str) -> dict[str, Any]:
    return {"method": "Target.targetDestroyed", "params": {"targetId": target_id}}


def test_jar_watchdog_recovers_from_last_page_destroyed_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jar_cookie = {"name": "token", "value": "v", "domain": "d", "path": "/"}
    calls: list[str] = []

    async def cdp(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        calls.append(method)
        if method == "Target.getTargets":
            # Initial tracking: p0 is the only page target.
            return {
                "targetInfos": [
                    {"targetId": "p0", "type": "page", "url": "about:blank"},
                    {"targetId": "b0", "type": "browser_ui", "url": "chrome://x/"},
                ]
            }
        if method == "Storage.setCookies":
            assert params["cookies"] == [jar_cookie]
        return {}

    monkeypatch.setattr(browser_layer, "_cdp_command", cdp)
    session = SimpleNamespace(name="browser", jar_cache=[jar_cookie])
    server, seen = _ws_event_server(_destroyed_event("p0"))
    port = server.getsockname()[1]
    stop = asyncio.Event()

    async def scenario() -> None:
        task = asyncio.create_task(
            browser_layer._jar_watchdog("browser", f"ws://127.0.0.1:{port}/devtools/browser/x", session, stop)
        )
        deadline = time.monotonic() + 5.0
        while "Storage.setCookies" not in calls and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        stop.set()
        await asyncio.wait_for(task, timeout=5.0)

    try:
        asyncio.run(scenario())
    finally:
        server.close()
    assert [m.get("method") for m in seen] == ["Target.setDiscoverTargets"]
    assert "Storage.setCookies" in calls, "the wipe must re-apply the snapshot"
    assert "Target.createTarget" in calls, "and re-create a landing tab"


def test_jar_watchdog_ignores_non_page_target_destroyed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def cdp(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        calls.append(method)
        if method == "Target.getTargets":
            return {
                "targetInfos": [
                    {"targetId": "p0", "type": "page", "url": "about:blank"},
                    {"targetId": "b0", "type": "browser_ui", "url": "chrome://x/"},
                ]
            }
        return {}

    monkeypatch.setattr(browser_layer, "_cdp_command", cdp)
    session = SimpleNamespace(name="browser", jar_cache=[{"name": "t", "value": "v"}])
    server, _seen = _ws_event_server(_destroyed_event("b0"))
    port = server.getsockname()[1]
    stop = asyncio.Event()

    async def scenario() -> None:
        task = asyncio.create_task(
            browser_layer._jar_watchdog("browser", f"ws://127.0.0.1:{port}/devtools/browser/x", session, stop)
        )
        await asyncio.sleep(0.5)  # let the event arrive and be handled
        stop.set()
        await asyncio.wait_for(task, timeout=5.0)

    try:
        asyncio.run(scenario())
    finally:
        server.close()
    assert "Storage.setCookies" not in calls, "closing a non-page target must not restore"
    assert "Target.createTarget" not in calls


def test_jar_watchdog_restores_when_context_emptied_while_other_context_alive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The wipe fires when a context loses its last page, even if pages in
    other contexts remain: restore the cookies but do not add a tab."""
    jar_cookie = {"name": "token", "value": "v", "domain": "d", "path": "/"}
    calls: list[str] = []

    async def cdp(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        calls.append(method)
        if method == "Target.getTargets":
            return {
                "targetInfos": [
                    {"targetId": "p0", "type": "page", "url": "about:blank", "browserContextId": "ctxA"},
                    {"targetId": "p1", "type": "page", "url": "about:blank", "browserContextId": "ctxB"},
                ]
            }
        if method == "Storage.setCookies":
            assert params["cookies"] == [jar_cookie]
            return {}
        return {}

    monkeypatch.setattr(browser_layer, "_cdp_command", cdp)
    session = SimpleNamespace(name="browser", jar_cache=[jar_cookie])
    server, _seen = _ws_event_server(_destroyed_event("p0"))
    port = server.getsockname()[1]
    stop = asyncio.Event()

    async def scenario() -> None:
        task = asyncio.create_task(
            browser_layer._jar_watchdog("browser", f"ws://127.0.0.1:{port}/devtools/browser/x", session, stop)
        )
        deadline = time.monotonic() + 5.0
        while "Storage.setCookies" not in calls and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        stop.set()
        await asyncio.wait_for(task, timeout=5.0)

    try:
        asyncio.run(scenario())
    finally:
        server.close()
    assert "Storage.setCookies" in calls, "emptying one context must re-apply the snapshot"
    assert "Target.createTarget" not in calls, "other pages remain, so no landing tab is needed"


def test_jar_watchdog_refreshes_jar_cache_on_cadence(monkeypatch: pytest.MonkeyPatch) -> None:
    """The refresher sentinel (not a get-cancellation) feeds cache refreshes."""
    fresh = [{"name": "login", "value": "new", "domain": "d", "path": "/"}]
    calls: list[str] = []

    async def cdp(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        calls.append(method)
        if method == "Target.getTargets":
            return {"targetInfos": [{"targetId": "p0", "type": "page", "url": "about:blank"}]}
        if method == "Storage.getCookies":
            return {"cookies": list(fresh)}
        return {}

    monkeypatch.setattr(browser_layer, "_cdp_command", cdp)
    monkeypatch.setattr(browser_layer, "_JAR_CACHE_REFRESH_SECONDS", 0.05)
    session = SimpleNamespace(name="browser", jar_cache=[])
    benign = {
        "method": "Target.targetInfoChanged",
        "params": {"targetInfo": {"targetId": "b0", "type": "browser_ui", "url": "chrome://x/"}},
    }
    server, _seen = _ws_event_server(benign)
    port = server.getsockname()[1]
    stop = asyncio.Event()

    async def scenario() -> None:
        task = asyncio.create_task(
            browser_layer._jar_watchdog("browser", f"ws://127.0.0.1:{port}/devtools/browser/x", session, stop)
        )
        deadline = time.monotonic() + 5.0
        while session.jar_cache != fresh and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        stop.set()
        await asyncio.wait_for(task, timeout=5.0)

    try:
        asyncio.run(scenario())
    finally:
        server.close()
    assert "Storage.getCookies" in calls
    assert session.jar_cache == fresh


def test_jar_watchdog_survives_endpoint_death_and_stops(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A dead endpoint triggers reconnect back-off, and stop still wins."""
    calls: list[str] = []

    async def cdp(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        calls.append(method)
        return {}

    monkeypatch.setattr(browser_layer, "_cdp_command", cdp)
    session = SimpleNamespace(name="browser", jar_cache=[])
    stop = asyncio.Event()

    async def scenario() -> None:
        task = asyncio.create_task(
            browser_layer._jar_watchdog("browser", "ws://127.0.0.1:1/devtools/browser/x", session, stop)
        )
        await asyncio.sleep(0.3)  # the refused connection must not kill the task
        stop.set()
        await asyncio.wait_for(task, timeout=5.0)

    asyncio.run(scenario())  # must exit on stop, not hang or crash


def test_shutdown_keeps_previous_state_when_jar_wiped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A wiped (empty) jar at teardown must not erase a saved login state."""
    saved_state = {
        "cookies": [{"name": "token", "value": "p3", "domain": "httpbin.org", "path": "/"}],
        "origins": [],
    }
    commands, fs = _run_handler_with_state_fs(json.dumps(saved_state).encode("utf-8"))
    config = DifyBrowserLayerConfig(persist_login_state=True)
    _capability, deps, _lease, _harness, _built = _wrap_run_fixture(monkeypatch, commands=commands, config=config)

    async def fake_cdp(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        if method == "Target.getTargets":
            return {"targetInfos": [{"targetId": "p0", "type": "page", "url": "about:blank"}]}
        if method == "Storage.getCookies":
            return {"cookies": []}  # the jar was wiped mid-run
        return {}

    monkeypatch.setattr(browser_layer, "_cdp_command", fake_cdp)

    async def scenario() -> object:
        return await _capability.wrap_run(RunCtx(deps=deps), handler=lambda: asyncio.sleep(0))

    asyncio.run(scenario())

    reread = asyncio.run(browser_layer._load_state_file_sandbox(commands, "/home/agent-1/.browser-state.json"))
    assert reread == saved_state, "a wiped jar must not erase the saved login state"
    writes = [call for call in commands.run_calls if call["script"].startswith("set -eu")]
    assert not writes, "the empty dump must not be written to the state file"


def test_shutdown_updates_state_when_jar_populated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-empty jar at teardown replaces the saved state."""
    saved_state = {
        "cookies": [{"name": "stale", "value": "old", "domain": "d", "path": "/"}],
        "origins": [],
    }
    dumped = [{"name": "token", "value": "fresh", "domain": "d", "path": "/"}]
    commands, fs = _run_handler_with_state_fs(json.dumps(saved_state).encode("utf-8"))
    config = DifyBrowserLayerConfig(persist_login_state=True)
    _capability, deps, _lease, _harness, _built = _wrap_run_fixture(monkeypatch, commands=commands, config=config)

    async def fake_cdp(ws_url: str, method: str, params: dict, timeout: float = 15.0) -> dict:
        if method == "Target.getTargets":
            return {"targetInfos": [{"targetId": "p0", "type": "page", "url": "about:blank"}]}
        if method == "Storage.getCookies":
            return {"cookies": list(dumped)}
        return {}

    monkeypatch.setattr(browser_layer, "_cdp_command", fake_cdp)

    async def scenario() -> object:
        return await _capability.wrap_run(RunCtx(deps=deps), handler=lambda: asyncio.sleep(0))

    asyncio.run(scenario())

    reread = asyncio.run(browser_layer._load_state_file_sandbox(commands, "/home/agent-1/.browser-state.json"))
    assert reread == browser_layer._cdp_to_state(dumped)


def test_wrap_run_without_persist_skips_state_io(monkeypatch: pytest.MonkeyPatch) -> None:
    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _result("job-1", output=_READY_OUTPUT, offset=len(_READY_OUTPUT))
    )
    capability, deps, _lease, _harness, _built = _wrap_run_fixture(monkeypatch, commands=commands)

    async def scenario() -> object:
        return await capability.wrap_run(RunCtx(deps=deps), handler=lambda: asyncio.sleep(0))

    asyncio.run(scenario())

    assert len(commands.run_calls) == 1, "only the launcher job may run"
    assert commands.run_calls[0]["env"]["BROWSER_PROFILE_DIR"].startswith("/home/agent-1/.browser/")
    assert commands.interrupt_calls == [{"job_id": "job-1", "grace_seconds": browser_layer._STATE_FLUSH_GRACE_SECONDS}]
    assert commands.delete_calls == [{"job_id": "job-1", "force": True}]


def test_wrap_run_fails_fast_when_browser_slots_are_saturated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _result("job-1", output=_READY_OUTPUT, offset=len(_READY_OUTPUT))
    )
    capability, deps, _lease, _harness, built = _wrap_run_fixture(monkeypatch, commands=commands)
    slots = BrowserSessionSlots(limit=1)
    assert slots.try_acquire()  # saturate the only slot
    deps.services.browser_session_slots = slots

    async def scenario() -> None:
        with pytest.raises(BrowserConcurrencyLimitError):
            await capability.wrap_run(RunCtx(deps=deps), handler=lambda: asyncio.sleep(0))

    asyncio.run(scenario())

    assert commands.run_calls == [], "a saturated slot must not start a browser job"
    assert built == []
    slots.release()


def test_wrap_run_acquires_and_releases_browser_slot(monkeypatch: pytest.MonkeyPatch) -> None:
    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _result("job-1", output=_READY_OUTPUT, offset=len(_READY_OUTPUT))
    )
    capability, deps, _lease, _harness, _built = _wrap_run_fixture(monkeypatch, commands=commands)
    slots = BrowserSessionSlots(limit=1)
    deps.services.browser_session_slots = slots

    async def scenario() -> object:
        return await capability.wrap_run(RunCtx(deps=deps), handler=lambda: asyncio.sleep(0))

    asyncio.run(scenario())

    # The run released its slot: a fresh acquire must succeed.
    assert slots.try_acquire()
    slots.release()


def test_wrap_run_releases_browser_slot_when_handler_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _result("job-1", output=_READY_OUTPUT, offset=len(_READY_OUTPUT))
    )
    capability, deps, _lease, _harness, _built = _wrap_run_fixture(monkeypatch, commands=commands)
    slots = BrowserSessionSlots(limit=1)
    deps.services.browser_session_slots = slots

    async def handler() -> str:
        raise RuntimeError("handler blew up")

    async def scenario() -> None:
        with pytest.raises(RuntimeError, match="handler blew up"):
            await capability.wrap_run(RunCtx(deps=deps), handler=handler)

    asyncio.run(scenario())

    assert slots.try_acquire(), "the failed run must have released its slot"
    slots.release()
