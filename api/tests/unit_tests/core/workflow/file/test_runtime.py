from __future__ import annotations

from collections.abc import Generator
from types import SimpleNamespace

import pytest

from core.workflow.file import runtime as runtime_module
from core.workflow.file.runtime import WorkflowFileRuntimeNotConfiguredError


def _dummy_generator() -> Generator[bytes, None, None]:
    if False:
        yield b""


def test_unconfigured_workflow_file_runtime_raises_on_all_accessors() -> None:
    original_runtime = runtime_module.get_workflow_file_runtime()
    runtime_module.set_workflow_file_runtime(runtime_module._UnconfiguredWorkflowFileRuntime())
    unconfigured = runtime_module.get_workflow_file_runtime()

    try:
        with pytest.raises(WorkflowFileRuntimeNotConfiguredError):
            _ = unconfigured.files_url
        with pytest.raises(WorkflowFileRuntimeNotConfiguredError):
            _ = unconfigured.internal_files_url
        with pytest.raises(WorkflowFileRuntimeNotConfiguredError):
            _ = unconfigured.secret_key
        with pytest.raises(WorkflowFileRuntimeNotConfiguredError):
            _ = unconfigured.files_access_timeout
        with pytest.raises(WorkflowFileRuntimeNotConfiguredError):
            _ = unconfigured.multimodal_send_format
        with pytest.raises(WorkflowFileRuntimeNotConfiguredError):
            unconfigured.http_get("https://example.com")
        with pytest.raises(WorkflowFileRuntimeNotConfiguredError):
            unconfigured.storage_load("path")
        with pytest.raises(WorkflowFileRuntimeNotConfiguredError):
            unconfigured.sign_tool_file(tool_file_id="tool", extension=".txt")
    finally:
        runtime_module.set_workflow_file_runtime(original_runtime)


def test_set_and_get_workflow_file_runtime() -> None:
    original_runtime = runtime_module.get_workflow_file_runtime()
    runtime = SimpleNamespace(
        files_url="https://files.example.com",
        internal_files_url="http://files.internal",
        secret_key="secret",
        files_access_timeout=60,
        multimodal_send_format="url",
        http_get=lambda url, follow_redirects=True: object(),
        storage_load=lambda path, stream=False: b"content" if not stream else _dummy_generator(),
        sign_tool_file=lambda tool_file_id, extension, for_external=True: "signed-url",
    )

    try:
        runtime_module.set_workflow_file_runtime(runtime)
        assert runtime_module.get_workflow_file_runtime() is runtime
    finally:
        runtime_module.set_workflow_file_runtime(original_runtime)
