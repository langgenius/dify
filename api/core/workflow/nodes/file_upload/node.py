import logging
import os
import posixpath
from collections.abc import Mapping, Sequence
from pathlib import PurePosixPath
from typing import Any, cast

from core.file import File, FileTransferMethod
from core.sandbox.bash.session import SANDBOX_READY_TIMEOUT
from core.sandbox.services.asset_download_service import AssetDownloadItem
from core.variables import ArrayFileSegment
from core.variables.segments import ArrayStringSegment, FileSegment
from core.virtual_environment.__base.command_future import CommandCancelledError, CommandTimeoutError
from core.virtual_environment.__base.helpers import pipeline
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node

from .entities import FileUploadNodeData
from .exc import FileUploadDownloadError, FileUploadNodeError

logger = logging.getLogger(__name__)


class FileUploadNode(Node[FileUploadNodeData]):
    """Upload workflow file variables into sandbox via presigned URLs.

    The node intentionally avoids streaming file bytes through Dify workers. For local/tool
    files, it generates storage-backed presigned URLs and lets sandbox download directly.
    """

    node_type = NodeType.FILE_UPLOAD

    @classmethod
    def version(cls) -> str:
        return "1"

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        _ = filters
        return {
            "type": "file-upload",
            "config": {
                "variable_selector": [],
            },
        }

    def _run(self) -> NodeRunResult:
        sandbox = self.graph_runtime_state.sandbox
        variable_selector = self.node_data.variable_selector
        inputs: dict[str, Any] = {"variable_selector": variable_selector}
        if sandbox is None:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="Sandbox not available for FileUploadNode.",
                error_type="SandboxNotInitializedError",
                inputs=inputs,
            )

        variable = self.graph_runtime_state.variable_pool.get(variable_selector)
        if variable is None:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=f"File variable not found for selector: {variable_selector}",
                error_type=FileUploadNodeError.__name__,
                inputs=inputs,
            )

        if variable.value and not isinstance(variable, ArrayFileSegment | FileSegment):
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=f"Variable {variable_selector} is not a file or file array",
                error_type=FileUploadNodeError.__name__,
                inputs=inputs,
            )

        files = self._normalize_files(variable.value)
        process_data: dict[str, Any] = {
            "file_count": len(files),
            "files": [file.to_dict() for file in files],
        }
        if not files:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                error="Selected file variable is empty.",
                error_type=FileUploadNodeError.__name__,
                inputs=inputs,
                process_data=process_data,
            )

        try:
            sandbox.wait_ready(timeout=SANDBOX_READY_TIMEOUT)
            download_items: list[AssetDownloadItem] = self._build_download_items(files)
            sandbox_paths = self._upload(sandbox.vm, download_items)
            file_names = [PurePosixPath(path).name for path in sandbox_paths]
            process_data = {
                **process_data,
                "sandbox_paths": sandbox_paths,
                "file_names": file_names,
            }

            outputs: dict[str, Any]
            if len(sandbox_paths) == 1:
                outputs = {
                    "sandbox_path": sandbox_paths[0],
                    "file_name": file_names[0],
                }
            else:
                outputs = {
                    "sandbox_path": ArrayStringSegment(value=sandbox_paths),
                    "file_name": ArrayStringSegment(value=file_names),
                }
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=inputs,
                process_data=process_data,
                outputs=outputs,
            )

        except CommandTimeoutError:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="File upload timeout",
                error_type=CommandTimeoutError.__name__,
                inputs=inputs,
                process_data=process_data,
            )
        except CommandCancelledError:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="File upload command was cancelled",
                error_type=CommandCancelledError.__name__,
                inputs=inputs,
                process_data=process_data,
            )
        except FileUploadNodeError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                error_type=type(e).__name__,
                inputs=inputs,
                process_data=process_data,
            )
        except Exception as e:
            logger.exception("File upload node %s failed", self.id)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                error_type=type(e).__name__,
                inputs=inputs,
                process_data=process_data,
            )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config
        typed_node_data = FileUploadNodeData.model_validate(node_data)
        return {node_id + ".files": typed_node_data.variable_selector}

    @staticmethod
    def _normalize_files(value: Any) -> list[File]:
        if isinstance(value, File):
            return [value]
        if isinstance(value, list):
            list_value = cast(list[object], value)
            files: list[File] = []
            for idx in range(len(list_value)):
                candidate = list_value[idx]
                if not isinstance(candidate, File):
                    return []
                files.append(candidate)
            return files
        return []

    def _build_download_items(self, files: Sequence[File]) -> list[AssetDownloadItem]:
        used_paths: set[str] = set()
        items: list[AssetDownloadItem] = []
        for index, file in enumerate(files):
            file_url = self._get_download_url(file)

            filename = (file.filename or "").strip()
            if not filename or filename in {".", ".."}:
                filename = f"file-{index + 1}{file.extension or ''}"
            filename = os.path.basename(filename)

            if filename in used_paths:
                stem = PurePosixPath(filename).stem or f"file-{index + 1}"
                suffix = PurePosixPath(filename).suffix
                dedupe = 1
                while filename in used_paths:
                    filename = f"{stem}_{dedupe}{suffix}"
                    dedupe += 1

            used_paths.add(filename)
            items.append(AssetDownloadItem(path=filename, url=file_url))
        return items

    @staticmethod
    def _normalize_path(path: str) -> str:
        normalized = posixpath.normpath(path.strip()) if path else "."
        if normalized.startswith("/"):
            normalized = normalized.lstrip("/")
        return normalized or "."

    def _upload(self, vm: Any, items: list[AssetDownloadItem]) -> list[str]:
        p = pipeline(vm)
        out_paths: list[str] = []
        for item in items:
            out_path = self._normalize_path(item.path)
            if out_path in ("", "."):
                raise FileUploadDownloadError("Download item path must point to a file")
            out_paths.append(out_path)
            p.add(["curl", "-fsSL", item.url, "-o", out_path], error_message="Failed to download file")

        try:
            p.execute(timeout=None, raise_on_error=True)
        except Exception as exc:
            raise FileUploadDownloadError(str(exc)) from exc

        return out_paths

    def _get_download_url(self, file: File) -> str:
        if file.transfer_method == FileTransferMethod.REMOTE_URL:
            if not file.remote_url:
                raise FileUploadDownloadError("Remote file URL is missing")
            return file.remote_url

        if file.transfer_method in (
            FileTransferMethod.LOCAL_FILE,
            FileTransferMethod.TOOL_FILE,
            FileTransferMethod.DATASOURCE_FILE,
        ):
            download_url = file.generate_url(for_external=True)
            if not download_url:
                raise FileUploadDownloadError("Unable to generate download URL for file")
            return download_url

        raise FileUploadDownloadError(f"Unsupported file transfer method: {file.transfer_method}")
