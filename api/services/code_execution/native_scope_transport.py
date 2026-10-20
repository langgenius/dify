"""Explicit A7 data-plane transport; no native capability or deployment activation.

The caller supplies an already claimed, fresh, no-network Code operation scope,
an admitted immutable interpreter profile, a durable dispatch owner, and the
physical lifetime owner. None of those authorities is manufactured here.

``execute`` requires the host's synchronous/async bridge. That bridge must execute
its factory on its owned loop, wait through cancellation and settlement, and
must not abandon work or nest an existing loop. ``execute_async`` supports an
already async owner directly. Clients are created and closed on that same loop;
the injected LocalNativeScopeClient is borrowed (it owns no persistent client).
HTTP lease close is never evidence of physical destruction.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import shlex
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any, Protocol, cast

from dify_agent.adapters.shell.protocols import ShellCommandResult
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol
from dify_agent.runtime_backend.local import LocalNativeScopeClient
from dify_agent.runtime_backend.native_test_scope import NativeScopeCommands, NativeScopeLease
from dify_agent.runtime_backend.protocols import RuntimeLayout

from runtime_contracts.code_execution import CodeExecutionError

_ERROR = "Native code execution unavailable"
# Only these fixed bootstraps enter shell text. Submitted payload is one JSON
# line on the scoped SDK input endpoint, after durable job association.
_PYTHON_BOOTSTRAP = "\n".join(
    [
        "import json, sys",
        "payload = json.loads(sys.stdin.readline())",
        "scope = {'__name__': '__main__', '__file__': '/workspace/runner.py'}",
        "exec(compile(payload['preload'], '/workspace/preload.py', 'exec'), scope)",
        "exec(compile(payload['code'], '/workspace/runner.py', 'exec'), scope)",
    ]
)
_NODE_BOOTSTRAP = "\n".join(
    [
        "const fs = require('node:fs');",
        "const chunks = []; const byte = Buffer.alloc(1);",
        "while (fs.readSync(0, byte, 0, 1, null)) {",
        "  if (byte[0] === 10) break; chunks.push(Buffer.from(byte));",
        "}",
        "const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
        "const Module = require('node:module');",
        "const runner = new Module('/workspace/runner.js', module);",
        "runner.filename = '/workspace/runner.js';",
        "runner.paths = Module._nodeModulePaths('/workspace');",
        "runner._compile(payload.preload + '\\n' + payload.code, runner.filename);",
    ]
)


@dataclass(frozen=True, slots=True)
class NativeCodeIdentity:
    operation_ref: str
    scope_id: str
    generation: int


@dataclass(frozen=True, slots=True)
class NativeCodeProfile:
    """Trusted selected environment; this DTO does not qualify its contents."""

    language: str
    executable: str
    environment_digest: str


@dataclass(frozen=True, slots=True)
class NativeCodeBounds:
    timeout_seconds: float
    output_bytes: int
    max_pages: int
    input_bytes: int
    close_seconds: float


class NativeCodeDurableOwner(Protocol):
    """Minimal future host/state port, NOT an in-memory production journal.

    assert_claim verifies the existing server-owned invocation/dispatch claim.
    reserve_dispatch atomically and durably associates operation, fresh scope,
    payload and profile digests with exactly one create attempt BEFORE any SDK
    I/O. It refuses any prior attempt (including unknown/lost ACK) across process
    restarts and adapter instances. associate_job durably attaches that exact job
    before payload input. mark_unknown retains ambiguous ownership/capacity.
    An exception is a refusal, never permission to retry. Completed replay and
    retained-job recovery belong to the existing result/physical owner, outside
    this one-shot adapter; this adapter never reruns or resends uncertain input.
    """

    def assert_claim(self, identity: NativeCodeIdentity) -> None: ...

    def reserve_dispatch(self, identity: NativeCodeIdentity, *, payload_digest: str, profile_digest: str) -> None: ...

    def associate_job(self, identity: NativeCodeIdentity, job_id: str) -> None: ...

    def mark_unknown(self, identity: NativeCodeIdentity) -> None: ...


class NativeCodeLifetimeOwner(Protocol):
    """Trusted acquisition fence and fresh-scope/no-network lifetime owner.

    check_current rejects stale acquisitions and any Agent/shared workspace.
    settle requests exact scope destruction or retains/quarantines its capacity;
    it must persist ambiguity before returning. Returning does not supply a
    physical cleanup receipt to this adapter. The host consumes that separately.
    """

    def check_current(self, identity: NativeCodeIdentity) -> None: ...

    async def settle(self, identity: NativeCodeIdentity, *, succeeded: bool) -> None: ...


class NativeCodeSyncOwner(Protocol):
    """Host loop/gevent bridge. No nested loop or detached timeout shortcut."""

    def run(self, operation: Callable[[], Coroutine[Any, Any, str]]) -> str: ...


@dataclass(frozen=True, slots=True)
class NativeScopeCodeExecutionTransport:
    identity: NativeCodeIdentity
    profile: NativeCodeProfile
    bounds: NativeCodeBounds
    scope_client: LocalNativeScopeClient
    durable_owner: NativeCodeDurableOwner | None
    lifetime_owner: NativeCodeLifetimeOwner | None
    sync_owner: NativeCodeSyncOwner | None

    def execute(self, *, language: str, preload: str, code: str) -> str:
        if self.sync_owner is None:
            raise CodeExecutionError(_ERROR)
        try:
            return self.sync_owner.run(lambda: self.execute_async(language=language, preload=preload, code=code))
        except Exception:
            raise CodeExecutionError(_ERROR) from None

    async def execute_async(self, *, language: str, preload: str, code: str) -> str:
        lease: NativeScopeLease | None = None
        reserved = False
        succeeded = False
        body_cancellation: asyncio.CancelledError | None = None
        try:
            self._validate(language)
            durable = self.durable_owner
            lifetime = self.lifetime_owner
            if durable is None or lifetime is None:
                raise CodeExecutionError(_ERROR)
            # No submitted payload serialization, scope inspect, file/job I/O
            # occurs before the existing claim and current acquisition check.
            self._check_current()
            payload = json.dumps({"preload": preload, "code": code}, ensure_ascii=True, separators=(",", ":")) + "\n"
            if len(payload.encode("utf-8")) > self.bounds.input_bytes:
                raise CodeExecutionError(_ERROR)
            durable.reserve_dispatch(
                self.identity,
                payload_digest=hashlib.sha256(payload.encode("utf-8")).hexdigest(),
                profile_digest=hashlib.sha256(
                    json.dumps(
                        {
                            "language": self.profile.language,
                            "executable": self.profile.executable,
                            "environment_digest": self.profile.environment_digest,
                        },
                        sort_keys=True,
                    ).encode("utf-8")
                ).hexdigest(),
            )
            reserved = True
            async with asyncio.timeout(self.bounds.timeout_seconds):
                self._check_current()
                handle = await self.scope_client.inspect(self.identity.scope_id, self.identity.generation)
                if handle.scope_id != self.identity.scope_id or handle.generation != self.identity.generation:
                    raise CodeExecutionError(_ERROR)
                client = self.scope_client.job_client(handle)
                lease = NativeScopeLease(
                    handle=f"native:{handle.scope_id}:{handle.generation}",
                    layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/workspace"),
                    client=cast(ShellctlClientProtocol, client),
                    commands=NativeScopeCommands(client=cast(ShellctlClientProtocol, client)),
                    workspace_generation=handle.generation,
                )
                self._check_current()
                # A fixed waiting bootstrap has no submitted payload and cannot
                # execute it before association. Never retry a lost create ACK.
                result = await lease.commands.run(
                    self._script(),
                    cwd="/workspace",
                    env=None,
                    timeout=min(0.05, self.bounds.timeout_seconds),
                    mode="stdio",
                )
                job_id = result.job_id
                if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", job_id) is None:
                    raise CodeExecutionError(_ERROR)
                if result.done or result.output or result.offset != 0 or result.truncated or result.status != "running":
                    raise CodeExecutionError(_ERROR)
                self._check_current()
                durable.associate_job(self.identity, job_id)
                self._check_current()
                result = await lease.commands.input(job_id, payload, offset=0, timeout=self.bounds.timeout_seconds)
                parts: list[str] = []
                offset = 0
                for page_index in range(self.bounds.max_pages):
                    self._check_current()
                    offset = self._page(result, job_id=job_id, offset=offset)
                    parts.append(result.output)
                    if result.done and not result.truncated:
                        final = await client.status(job_id)
                        self._check_current()
                        if (final.job_id, final.status, final.done, final.exit_code, final.offset) != (
                            job_id,
                            "exited",
                            True,
                            0,
                            offset,
                        ):
                            raise CodeExecutionError(_ERROR)
                        succeeded = True
                        return "".join(parts)
                    if page_index + 1 == self.bounds.max_pages:
                        raise CodeExecutionError(_ERROR)
                    result = await lease.commands.wait(job_id, offset=offset, timeout=self.bounds.timeout_seconds)
                raise CodeExecutionError(_ERROR)
        except asyncio.CancelledError as exc:
            body_cancellation = exc
            raise
        except Exception:
            raise CodeExecutionError(_ERROR) from None
        finally:
            if reserved:
                await self._finish(lease, succeeded=succeeded, cancellation=body_cancellation)

    async def _finish(
        self, lease: NativeScopeLease | None, *, succeeded: bool, cancellation: asyncio.CancelledError | None
    ) -> None:
        """Join bounded cleanup despite caller cancellation, then propagate it.

        The child is retained and always joined here: it never outlives this
        operation. Shielding keeps repeated caller cancellation from cancelling
        close/settlement or resetting their admitted deadlines. Ambiguity is
        recorded immediately even if settlement already received succeeded=True.
        """
        cancelled = asyncio.Event()
        if cancellation is not None:
            cancelled.set()
        cleanup = asyncio.create_task(self._close_and_settle(lease, succeeded=succeeded, cancelled=cancelled))
        pending_cancellation = cancellation
        unknown_failed = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError as exc:
                if pending_cancellation is None:
                    pending_cancellation = exc
                if not cancelled.is_set():
                    cancelled.set()
                    try:
                        self._mark_unknown()
                    except CodeExecutionError:
                        # Persistence outage must not abandon the still-owned
                        # close/settlement task. Its finally still hands off.
                        unknown_failed = True
            except Exception:
                break
        try:
            cleanup.result()
        except BaseException as cleanup_error:
            if pending_cancellation is not None:
                raise pending_cancellation from cleanup_error
            raise
        if pending_cancellation is not None:
            raise pending_cancellation
        if unknown_failed:
            raise CodeExecutionError(_ERROR)

    async def _close_and_settle(
        self, lease: NativeScopeLease | None, *, succeeded: bool, cancelled: asyncio.Event
    ) -> None:
        # Independent finite budgets: cancellation of close's timeout must not
        # consume settlement's timer or leave its await unbounded in a finally.
        close_failed = False
        try:
            async with asyncio.timeout(self.bounds.close_seconds):
                if lease is not None:
                    await lease.close()
        except (Exception, asyncio.CancelledError):
            close_failed = True
        try:
            try:
                if not succeeded or close_failed or cancelled.is_set():
                    self._mark_unknown()
            finally:
                async with asyncio.timeout(self.bounds.close_seconds):
                    if self.lifetime_owner is not None:
                        await self.lifetime_owner.settle(
                            self.identity, succeeded=succeeded and not close_failed and not cancelled.is_set()
                        )
        except (Exception, asyncio.CancelledError):
            self._mark_unknown()
            raise CodeExecutionError(_ERROR) from None
        if close_failed:
            raise CodeExecutionError(_ERROR)

    def _mark_unknown(self) -> None:
        try:
            if self.durable_owner is not None:
                self.durable_owner.mark_unknown(self.identity)
        except Exception:
            raise CodeExecutionError(_ERROR) from None

    def _check_current(self) -> None:
        if self.durable_owner is None or self.lifetime_owner is None:
            raise CodeExecutionError(_ERROR)
        self.durable_owner.assert_claim(self.identity)
        self.lifetime_owner.check_current(self.identity)

    def _validate(self, language: str) -> None:
        if (
            language != self.profile.language
            or language not in {"python3", "nodejs"}
            or re.fullmatch(r"/[A-Za-z0-9_./-]+", self.profile.executable) is None
            or ".." in self.profile.executable.split("/")
            or re.fullmatch(r"[a-f0-9]{64}", self.profile.environment_digest) is None
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,95}", self.identity.scope_id) is None
            or not self.identity.operation_ref
            or type(self.identity.generation) is not int
            or self.identity.generation < 1
            or any(
                type(value) is not int
                for value in (self.bounds.input_bytes, self.bounds.output_bytes, self.bounds.max_pages)
            )
            or any(
                not math.isfinite(value) or value <= 0
                for value in (
                    self.bounds.timeout_seconds,
                    self.bounds.close_seconds,
                    self.bounds.input_bytes,
                    self.bounds.output_bytes,
                    self.bounds.max_pages,
                )
            )
        ):
            raise CodeExecutionError(_ERROR)

    def _script(self) -> str:
        bootstrap = _PYTHON_BOOTSTRAP if self.profile.language == "python3" else _NODE_BOOTSTRAP
        flag = "-c" if self.profile.language == "python3" else "-e"
        return f"exec {shlex.quote(self.profile.executable)} {flag} {shlex.quote(bootstrap)}"

    def _page(self, result: ShellCommandResult, *, job_id: str, offset: int) -> int:
        actual_offset = offset + len(result.output.encode("utf-8"))
        if (
            result.job_id != job_id
            or result.offset != actual_offset
            or actual_offset > self.bounds.output_bytes
            or result.status not in {"running", "exited"}
            or result.done != (result.status == "exited")
            or (result.done and result.exit_code != 0)
            or (not result.done and result.exit_code is not None)
        ):
            raise CodeExecutionError(_ERROR)
        return actual_offset
