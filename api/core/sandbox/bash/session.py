from __future__ import annotations

import json
import logging
import mimetypes
import os
from io import BytesIO
from types import TracebackType

from core.file import File, FileTransferMethod, FileType
from core.sandbox.sandbox import Sandbox
from core.session.cli_api import CliApiSession, CliApiSessionManager, CliContext
from core.skill.entities import ToolAccessPolicy
from core.skill.entities.tool_dependencies import ToolDependencies
from core.tools.signature import sign_tool_file
from core.tools.tool_file_manager import ToolFileManager
from core.virtual_environment.__base.exec import CommandExecutionError
from core.virtual_environment.__base.helpers import execute, pipeline

from ..bash.dify_cli import DifyCliConfig
from ..entities import DifyCli
from .bash_tool import SandboxBashTool

logger = logging.getLogger(__name__)

SANDBOX_READY_TIMEOUT = 60 * 10

# Default output directory for sandbox-generated files
SANDBOX_OUTPUT_DIR = "output"
# Maximum number of files to collect from sandbox output
MAX_OUTPUT_FILES = 50
# Maximum file size to collect (10MB)
MAX_OUTPUT_FILE_SIZE = 10 * 1024 * 1024


class SandboxBashSession:
    def __init__(self, *, sandbox: Sandbox, node_id: str, tools: ToolDependencies | None) -> None:
        self._sandbox = sandbox
        self._node_id = node_id
        self._tools = tools
        self._bash_tool: SandboxBashTool | None = None
        self._cli_api_session: CliApiSession | None = None
        self._tenant_id = sandbox.tenant_id
        self._user_id = sandbox.user_id
        self._app_id = sandbox.app_id
        self._assets_id = sandbox.assets_id

    def __enter__(self) -> SandboxBashSession:
        # Ensure sandbox initialization completes before any bash commands run.
        self._sandbox.wait_ready(timeout=SANDBOX_READY_TIMEOUT)
        self._cli_api_session = CliApiSessionManager().create(
            tenant_id=self._tenant_id,
            user_id=self._user_id,
            context=CliContext(tool_access=ToolAccessPolicy.from_dependencies(self._tools)),
        )
        if self._tools is not None and not self._tools.is_empty():
            tools_path = self._setup_node_tools_directory(self._node_id, self._tools, self._cli_api_session)
        else:
            tools_path = DifyCli.GLOBAL_TOOLS_PATH

        self._bash_tool = SandboxBashTool(
            sandbox=self._sandbox.vm,
            tenant_id=self._tenant_id,
            tools_path=tools_path,
        )
        return self

    def _setup_node_tools_directory(
        self,
        node_id: str,
        tools: ToolDependencies,
        cli_api_session: CliApiSession,
    ) -> str:
        node_tools_path = f"{DifyCli.TOOLS_ROOT}/{node_id}"

        vm = self._sandbox.vm
        (
            pipeline(vm)
            .add(["mkdir", "-p", DifyCli.GLOBAL_TOOLS_PATH], error_message="Failed to create global tools dir")
            .add(["mkdir", "-p", node_tools_path], error_message="Failed to create node tools dir")
            .execute(raise_on_error=True)
        )

        config_json = json.dumps(
            DifyCliConfig.create(session=cli_api_session, tenant_id=self._tenant_id, tool_deps=tools).model_dump(
                mode="json"
            ),
            ensure_ascii=False,
        )
        vm.upload_file(f"{node_tools_path}/{DifyCli.CONFIG_FILENAME}", BytesIO(config_json.encode("utf-8")))

        pipeline(vm, cwd=node_tools_path).add(
            [DifyCli.PATH, "init"], error_message="Failed to initialize Dify CLI"
        ).execute(raise_on_error=True)

        logger.info(
            "Node %s tools initialized, path=%s, tool_count=%d", node_id, node_tools_path, len(tools.references)
        )
        return node_tools_path

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        try:
            if self._cli_api_session is not None:
                CliApiSessionManager().delete(self._cli_api_session.id)
                logger.debug("Cleaned up SandboxSession session_id=%s", self._cli_api_session.id)
                self._cli_api_session = None
        except Exception:
            logger.exception("Failed to cleanup SandboxSession")
        return False

    @property
    def bash_tool(self) -> SandboxBashTool:
        if self._bash_tool is None:
            raise RuntimeError("SandboxSession is not initialized")
        return self._bash_tool

    def collect_output_files(self, output_dir: str = SANDBOX_OUTPUT_DIR) -> list[File]:
        vm = self._sandbox.vm
        collected_files: list[File] = []

        try:
            file_states = vm.list_files(output_dir, limit=MAX_OUTPUT_FILES)
        except Exception as exc:
            # Output directory may not exist if no files were generated
            logger.debug("Failed to list sandbox output files in %s: %s", output_dir, exc)
            return collected_files

        for file_state in file_states:
            # Skip files that are too large
            if file_state.size > MAX_OUTPUT_FILE_SIZE:
                logger.warning(
                    "Skipping sandbox output file %s: size %d exceeds limit %d",
                    file_state.path,
                    file_state.size,
                    MAX_OUTPUT_FILE_SIZE,
                )
                continue

            try:
                # file_state.path is already relative to working_path (e.g., "output/file.png")
                file_content = vm.download_file(file_state.path)
                file_binary = file_content.getvalue()

                filename = os.path.basename(file_state.path)
                file_obj = self._create_tool_file(filename=filename, file_binary=file_binary)
                collected_files.append(file_obj)

                logger.info(
                    "Collected sandbox output file: %s -> tool_file_id=%s",
                    file_state.path,
                    file_obj.id,
                )

            except Exception as exc:
                logger.warning("Failed to collect sandbox output file %s: %s", file_state.path, exc)
                continue

        logger.info(
            "Collected %d files from sandbox output directory %s",
            len(collected_files),
            output_dir,
        )
        return collected_files

    def download_file(self, path: str) -> File:
        path_kind = self._detect_path_kind(path)
        if path_kind == "dir":
            raise ValueError("Directory outputs are not supported")
        if path_kind != "file":
            raise ValueError(f"Sandbox file not found: {path}")

        file_content = self._sandbox.vm.download_file(path)
        file_binary = file_content.getvalue()
        if len(file_binary) > MAX_OUTPUT_FILE_SIZE:
            raise ValueError(f"Sandbox file exceeds size limit: {path}")

        filename = os.path.basename(path) or "file"
        return self._create_tool_file(filename=filename, file_binary=file_binary)

    def _detect_path_kind(self, path: str) -> str:
        script = r"""
import os
import sys

p = sys.argv[1]
if os.path.isdir(p):
    print("dir")
    raise SystemExit(0)
if os.path.isfile(p):
    print("file")
    raise SystemExit(0)
print("none")
raise SystemExit(2)
"""
        try:
            result = execute(
                self._sandbox.vm,
                [
                    "sh",
                    "-c",
                    'if command -v python3 >/dev/null 2>&1; then py=python3; else py=python; fi; "$py" -c "$0" "$@"',
                    script,
                    path,
                ],
                timeout=10,
                error_message="Failed to inspect sandbox path",
            )
        except CommandExecutionError as exc:
            raise ValueError(str(exc)) from exc
        return result.stdout.decode("utf-8", errors="replace").strip()

    def _create_tool_file(self, *, filename: str, file_binary: bytes) -> File:
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = "application/octet-stream"

        tool_file = ToolFileManager().create_file_by_raw(
            user_id=self._user_id,
            tenant_id=self._tenant_id,
            conversation_id=None,
            file_binary=file_binary,
            mimetype=mime_type,
            filename=filename,
        )

        file_type = _get_file_type_from_mime(mime_type)
        extension = os.path.splitext(filename)[1] if "." in filename else ".bin"
        url = sign_tool_file(tool_file.id, extension)

        return File(
            id=tool_file.id,
            tenant_id=self._tenant_id,
            type=file_type,
            transfer_method=FileTransferMethod.TOOL_FILE,
            filename=filename,
            extension=extension,
            mime_type=mime_type,
            size=len(file_binary),
            related_id=tool_file.id,
            url=url,
            storage_key=tool_file.file_key,
        )


def _get_file_type_from_mime(mime_type: str) -> FileType:
    """Determine FileType from mime type."""
    if mime_type.startswith("image/"):
        return FileType.IMAGE
    elif mime_type.startswith("video/"):
        return FileType.VIDEO
    elif mime_type.startswith("audio/"):
        return FileType.AUDIO
    elif "text" in mime_type or "pdf" in mime_type:
        return FileType.DOCUMENT
    else:
        return FileType.CUSTOM
