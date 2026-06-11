"""Sandbox file-operation service for the Dify Agent server.

The public ``/sandbox`` routes must stay inside Agenton's shell-layer boundary:
they reconstruct a minimal compositor from the submitted ``SandboxLocator``,
resume the shell layer, run one ephemeral command, and suspend the layers again
so the workspace remains reusable. The service owns request-level guardrails such
as read-size limits and error-code mapping; the shell layer owns workspace and
subprocess lifecycle.
"""

from __future__ import annotations

import json
from textwrap import dedent

from agenton.layers import LifecycleState

from dify_agent.layers.execution_context import DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.layers.shell.layer import (
    DifyShellLayer,
    DifyShellLayerRuntimeState,
    ShellCommandResult,
    ShellCommandTimeoutError,
)
from dify_agent.protocol import (
    SandboxListFilesRequest,
    SandboxListResult,
    SandboxLocator,
    SandboxReadFileRequest,
    SandboxReadResult,
    SandboxUploadFileRequest,
    SandboxUploadResult,
    normalize_composition,
)
from dify_agent.runtime.compositor_factory import DifyAgentLayerProvider, build_pydantic_ai_compositor

_LIST_ENTRIES_LIMIT = 1000
_LIST_SCRIPT = dedent(
    f"""
    python - <<'PY'
    import heapq
    import json
    import os
    from pathlib import Path

    def fail(code: str, message: str) -> None:
        print(json.dumps({{"ok": False, "code": code, "message": message}}), end="")
        raise SystemExit(1)

    relative_path = os.environ.get("DIFY_SANDBOX_RELATIVE_PATH", ".") or "."
    if Path(relative_path).is_absolute():
        fail("sandbox_path_invalid", "Sandbox paths must be relative.")
    if any(ord(char) < 32 for char in relative_path):
        fail("sandbox_path_invalid", "Sandbox paths must not contain control characters.")
    workspace = Path(os.environ["DIFY_SANDBOX_PATH"]).resolve()
    target = (workspace / relative_path).resolve()
    try:
        target.relative_to(workspace)
    except ValueError:
        fail("sandbox_path_invalid", "Sandbox path escapes the workspace.")
    if not target.exists():
        fail("sandbox_file_not_found", "Sandbox path does not exist.")
    if not target.is_dir():
        fail("sandbox_path_invalid", "Sandbox path is not a directory.")

    entries = []
    visible_children = heapq.nsmallest({_LIST_ENTRIES_LIMIT} + 1, target.iterdir(), key=lambda item: item.name)
    truncated = len(visible_children) > {_LIST_ENTRIES_LIMIT}
    for child in visible_children[:{_LIST_ENTRIES_LIMIT}]:
        stat_result = child.stat()
        entries.append(
            {{
                "name": child.name,
                "type": "directory" if child.is_dir() else "file",
                "size": int(stat_result.st_size),
                "mtime": int(stat_result.st_mtime),
            }}
        )

    print(
        json.dumps(
            {{
                "ok": True,
                "result": {{
                    "path": relative_path,
                    "entries": entries,
                    "truncated": truncated,
                }},
            }}
        ),
        end="",
    )
    PY
    """
).strip()
_READ_SCRIPT = dedent(
    """
    python - <<'PY'
    import base64
    import json
    import os
    from pathlib import Path

    def fail(code: str, message: str) -> None:
        print(json.dumps({"ok": False, "code": code, "message": message}), end="")
        raise SystemExit(1)

    relative_path = os.environ.get("DIFY_SANDBOX_RELATIVE_PATH", "")
    if not relative_path:
        fail("sandbox_path_invalid", "Sandbox read path must not be empty.")
    if Path(relative_path).is_absolute():
        fail("sandbox_path_invalid", "Sandbox paths must be relative.")
    if any(ord(char) < 32 for char in relative_path):
        fail("sandbox_path_invalid", "Sandbox paths must not contain control characters.")
    workspace = Path(os.environ["DIFY_SANDBOX_PATH"]).resolve()
    target = (workspace / relative_path).resolve()
    try:
        target.relative_to(workspace)
    except ValueError:
        fail("sandbox_path_invalid", "Sandbox path escapes the workspace.")
    if not target.exists():
        fail("sandbox_file_not_found", "Sandbox file does not exist.")
    if not target.is_file():
        fail("sandbox_path_invalid", "Sandbox path is not a file.")

    max_bytes = int(os.environ["DIFY_SANDBOX_MAX_BYTES"])
    encoding = os.environ["DIFY_SANDBOX_ENCODING"]
    size = int(target.stat().st_size)
    with target.open("rb") as file:
        payload = file.read(max_bytes + 1)
    truncated = len(payload) > max_bytes
    payload = payload[:max_bytes]
    if encoding == "utf-8":
        content = payload.decode("utf-8", errors="replace")
    elif encoding == "base64":
        content = base64.b64encode(payload).decode("ascii")
    else:
        fail("sandbox_command_failed", f"Unsupported sandbox read encoding: {encoding}")

    print(
        json.dumps(
            {
                "ok": True,
                "result": {
                    "path": relative_path,
                    "encoding": encoding,
                    "content": content,
                    "size": size,
                    "truncated": truncated,
                },
            }
        ),
        end="",
    )
    PY
    """
).strip()
_UPLOAD_SCRIPT = dedent(
    """
    python - <<'PY'
    import json
    import os
    import subprocess
    from pathlib import Path

    def fail(code: str, message: str) -> None:
        print(json.dumps({"ok": False, "code": code, "message": message}), end="")
        raise SystemExit(1)

    relative_path = os.environ.get("DIFY_SANDBOX_RELATIVE_PATH", "")
    if not relative_path:
        fail("sandbox_path_invalid", "Sandbox upload path must not be empty.")
    if Path(relative_path).is_absolute():
        fail("sandbox_path_invalid", "Sandbox paths must be relative.")
    if any(ord(char) < 32 for char in relative_path):
        fail("sandbox_path_invalid", "Sandbox paths must not contain control characters.")
    workspace = Path(os.environ["DIFY_SANDBOX_PATH"]).resolve()
    target = (workspace / relative_path).resolve()
    try:
        target.relative_to(workspace)
    except ValueError:
        fail("sandbox_path_invalid", "Sandbox path escapes the workspace.")
    if not target.exists() or not target.is_file():
        fail("sandbox_file_not_found", "Sandbox file does not exist.")
    max_upload_bytes = int(os.environ["DIFY_SANDBOX_MAX_UPLOAD_BYTES"])
    size = int(target.stat().st_size)
    if size > max_upload_bytes:
        fail("sandbox_file_too_large", f"Sandbox uploads are limited to {max_upload_bytes} bytes.")

    try:
        completed = subprocess.run(
            ["dify-agent-stub", "file", "upload", "--json", "--path", str(target)],
            capture_output=True,
            text=True,
            check=False,
            env=os.environ.copy(),
        )
    except FileNotFoundError:
        fail("sandbox_upload_failed", "dify-agent-stub is not installed in the sandbox environment.")

    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "sandbox upload command failed"
        fail("sandbox_upload_failed", message)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        fail("sandbox_upload_failed", "Sandbox upload command returned invalid JSON.")

    file_payload = payload.get("file") if isinstance(payload, dict) else None
    if not isinstance(file_payload, dict):
        file_payload = payload if isinstance(payload, dict) else None
    if not isinstance(file_payload, dict):
        fail("sandbox_upload_failed", "Sandbox upload command returned an unexpected payload.")

    required = {"id", "name", "size", "mime_type"}
    if any(key not in file_payload for key in required):
        fail("sandbox_upload_failed", "Sandbox upload payload is missing required file fields.")

    print(
        json.dumps(
            {
                "ok": True,
                "result": {
                    "path": relative_path,
                    "file": {
                        "id": str(file_payload["id"]),
                        "name": str(file_payload["name"]),
                        "size": int(file_payload["size"]),
                        "mime_type": str(file_payload["mime_type"]),
                    },
                },
            }
        ),
        end="",
    )
    PY
    """
).strip()


class SandboxServiceError(Exception):
    """Typed sandbox API error returned by the service layer."""

    status_code: int
    code: str
    message: str

    def __init__(self, *, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


class SandboxService:
    """Resume sandboxes and perform typed file operations through the shell layer."""

    layer_providers: tuple[DifyAgentLayerProvider, ...]
    command_timeout_seconds: float
    max_read_bytes: int
    max_upload_bytes: int

    def __init__(
        self,
        *,
        layer_providers: tuple[DifyAgentLayerProvider, ...],
        command_timeout_seconds: float,
        max_read_bytes: int,
        max_upload_bytes: int,
    ) -> None:
        self.layer_providers = layer_providers
        self.command_timeout_seconds = command_timeout_seconds
        self.max_read_bytes = max_read_bytes
        self.max_upload_bytes = max_upload_bytes

    async def list_files(self, request: SandboxListFilesRequest) -> SandboxListResult:
        """List one directory inside the located sandbox workspace."""
        payload = await self._run_locator_command(
            request.locator,
            _LIST_SCRIPT,
            extra_env={"DIFY_SANDBOX_RELATIVE_PATH": request.path},
        )
        return SandboxListResult.model_validate(payload)

    async def read_file(self, request: SandboxReadFileRequest) -> SandboxReadResult:
        """Read one sandbox file as text or base64."""
        if request.max_bytes > self.max_read_bytes:
            raise SandboxServiceError(
                status_code=413,
                code="sandbox_file_too_large",
                message=f"Sandbox reads are limited to {self.max_read_bytes} bytes.",
            )
        payload = await self._run_locator_command(
            request.locator,
            _READ_SCRIPT,
            extra_env={
                "DIFY_SANDBOX_RELATIVE_PATH": request.path,
                "DIFY_SANDBOX_ENCODING": request.encoding,
                "DIFY_SANDBOX_MAX_BYTES": str(request.max_bytes),
            },
        )
        return SandboxReadResult.model_validate(payload)

    async def upload_file(self, request: SandboxUploadFileRequest) -> SandboxUploadResult:
        """Upload one sandbox file through the sandbox-installed stub CLI."""
        payload = await self._run_locator_command(
            request.locator,
            _UPLOAD_SCRIPT,
            extra_env={
                "DIFY_SANDBOX_RELATIVE_PATH": request.path,
                "DIFY_SANDBOX_MAX_UPLOAD_BYTES": str(self.max_upload_bytes),
            },
        )
        return SandboxUploadResult.model_validate(payload)

    async def _run_locator_command(
        self,
        locator: SandboxLocator,
        script: str,
        *,
        extra_env: dict[str, str],
    ) -> object:
        graph_config, layer_configs = normalize_composition(locator.composition)
        try:
            self._validate_locator(locator)
            compositor = build_pydantic_ai_compositor(graph_config, providers=self.layer_providers)
            async with compositor.enter(configs=layer_configs, session_snapshot=locator.session_snapshot) as run:
                run.suspend_on_exit()
                shell_layer = run.get_layer(locator.shell_layer_name, DifyShellLayer)
                result = await shell_layer.run_ephemeral_command(
                    script,
                    timeout=self.command_timeout_seconds,
                    extra_env=extra_env,
                )
        except ShellCommandTimeoutError as exc:
            raise SandboxServiceError(
                status_code=504,
                code="sandbox_command_timeout",
                message=str(exc) or "Sandbox command timed out.",
            ) from exc
        except (KeyError, RuntimeError, TypeError, ValueError) as exc:
            raise SandboxServiceError(
                status_code=404,
                code="sandbox_not_found",
                message=str(exc) or "Sandbox shell could not be resumed.",
            ) from exc

        return self._parse_command_result(result)

    def _validate_locator(self, locator: SandboxLocator) -> None:
        """Reject locators that do not match the server-managed shell contract.

        ``SandboxLocator`` arrives from an external caller, so the service must
        enforce the exact shell subset it knows how to resume instead of trusting
        arbitrary composition/runtime-state combinations. In particular, the
        shell ``workspace_cwd`` must match the server-managed root plus the shell
        ``session_id`` exactly; otherwise callers could point sandbox operations
        at arbitrary host directories.
        """
        composition_names = [layer.name for layer in locator.composition.layers]
        snapshot_names = [layer.name for layer in locator.session_snapshot.layers]
        if composition_names != snapshot_names:
            raise ValueError("Sandbox locator composition and session snapshot must list the same layers in order.")

        composition_by_name = {layer.name: layer for layer in locator.composition.layers}
        snapshot_by_name = {layer.name: layer for layer in locator.session_snapshot.layers}
        shell_layer = composition_by_name.get(locator.shell_layer_name)
        shell_snapshot = snapshot_by_name.get(locator.shell_layer_name)
        if shell_layer is None or shell_snapshot is None:
            raise ValueError("Sandbox locator is missing required shell state.")

        if shell_layer.type != DIFY_SHELL_LAYER_TYPE_ID:
            raise ValueError("Sandbox shell layer type is invalid.")
        execution_context_target_name = shell_layer.deps.get("execution_context")
        if not execution_context_target_name:
            raise ValueError("Sandbox shell layer dependencies are invalid.")
        execution_context_layer = composition_by_name.get(execution_context_target_name)
        if execution_context_layer is None:
            raise ValueError("Sandbox locator is missing the shell execution_context dependency.")
        if execution_context_layer.type != DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID:
            raise ValueError("Sandbox execution_context layer type is invalid.")

        reachable_names = _collect_transitive_dependency_names(
            composition_by_name=composition_by_name,
            root_layer_name=locator.shell_layer_name,
        )
        if execution_context_target_name not in reachable_names:
            raise ValueError("Sandbox locator must include execution_context in the shell dependency closure.")
        if set(composition_names) != reachable_names:
            raise ValueError("Sandbox locator contains layers outside the shell dependency closure.")

        _ = DifyShellLayerConfig.model_validate(shell_layer.config)
        if shell_snapshot.lifecycle_state is not LifecycleState.SUSPENDED:
            raise ValueError("Sandbox shell snapshot must be suspended.")

        runtime_state = DifyShellLayerRuntimeState.model_validate(shell_snapshot.runtime_state)
        expected_workspace = DifyShellLayer.workspace_path_for_session_id(runtime_state.session_id)
        if runtime_state.workspace_cwd != str(expected_workspace):
            raise ValueError("Sandbox shell workspace path is invalid.")
        if not expected_workspace.exists() or not expected_workspace.is_dir():
            raise ValueError("Sandbox shell workspace no longer exists.")

    def _parse_command_result(self, result: ShellCommandResult) -> object:
        payload_text = result.stdout.strip() or result.stderr.strip()
        payload: object | None = None
        if payload_text:
            try:
                payload = json.loads(payload_text)
            except json.JSONDecodeError:
                payload = None

        if result.exit_code != 0:
            if isinstance(payload, dict) and isinstance(payload.get("code"), str) and isinstance(payload.get("message"), str):
                raise SandboxServiceError(
                    status_code=_status_code_for_error(payload["code"]),
                    code=payload["code"],
                    message=payload["message"],
                )
            raise SandboxServiceError(
                status_code=502,
                code="sandbox_command_failed",
                message=result.stderr.strip() or result.stdout.strip() or "Sandbox command failed.",
            )

        if not isinstance(payload, dict) or payload.get("ok") is not True:
            raise SandboxServiceError(
                status_code=502,
                code="sandbox_command_failed",
                message="Sandbox command returned an invalid payload.",
            )
        return payload.get("result")


def _collect_transitive_dependency_names(
    *,
    composition_by_name: dict[str, object],
    root_layer_name: str,
) -> set[str]:
    pending_names = [root_layer_name]
    reachable_names: set[str] = set()
    while pending_names:
        current_name = pending_names.pop()
        if current_name in reachable_names:
            continue
        current_layer = composition_by_name.get(current_name)
        if current_layer is None:
            raise ValueError(f"Sandbox dependency layer '{current_name}' is missing from composition.")
        reachable_names.add(current_name)
        pending_names.extend(current_layer.deps.values())  # pyright: ignore[reportAttributeAccessIssue]
    return reachable_names

def _status_code_for_error(code: str) -> int:
    if code == "sandbox_not_found":
        return 404
    if code == "sandbox_path_invalid":
        return 400
    if code == "sandbox_file_not_found":
        return 404
    if code == "sandbox_file_too_large":
        return 413
    if code == "sandbox_command_timeout":
        return 504
    if code == "sandbox_upload_failed":
        return 502
    if code == "sandbox_unavailable":
        return 503
    return 502


__all__ = ["SandboxService", "SandboxServiceError"]
