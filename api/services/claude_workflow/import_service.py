"""Import Claude workflow files by compiling them into native Dify DSL first.

This service sits in front of ``AppDslService``. It detects Claude workflow
documents, validates them, compiles them to Dify YAML, and then delegates to
the existing DSL import path. Non-Claude files still flow through the native
``AppDslService`` logic unchanged.
"""

from __future__ import annotations

import uuid
from urllib.parse import urlparse

import yaml
from sqlalchemy.orm import Session

from core.helper import ssrf_proxy
from models import Account
from services.app_dsl_service import AppDslService, Import, ImportMode, ImportStatus

from .compiler import compile_claude_workflow_to_dify_dsl
from .errors import ClaudeWorkflowCompilerError, ClaudeWorkflowSchemaValidationError
from .schema import parse_claude_workflow_document

DSL_MAX_SIZE = 10 * 1024 * 1024  # 10MB


class ClaudeWorkflowImportExecutionError(ValueError):
    """Controller-facing import failure with a prebuilt payload and status code."""

    status_code: int
    payload: Import

    def __init__(self, *, status_code: int, payload: Import) -> None:
        self.status_code = status_code
        self.payload = payload
        super().__init__(payload.error)


class ClaudeWorkflowImportService:
    """Detect Claude workflow files and compile them before importing."""

    _session: Session
    _dsl_service: AppDslService

    def __init__(self, session: Session, dsl_service: AppDslService | None = None) -> None:
        self._session = session
        self._dsl_service = dsl_service or AppDslService(session)

    def import_app(
        self,
        *,
        account: Account,
        import_mode: str,
        yaml_content: str | None = None,
        yaml_url: str | None = None,
        name: str | None = None,
        description: str | None = None,
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
        app_id: str | None = None,
    ) -> Import:
        """Import native Dify DSL directly or compile Claude workflow first."""

        content = self._load_yaml_content(import_mode=import_mode, yaml_content=yaml_content, yaml_url=yaml_url)
        if not content:
            return self._delegate_import(
                account=account,
                import_mode=import_mode,
                yaml_content=yaml_content,
                yaml_url=yaml_url,
                name=name,
                description=description,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
                app_id=app_id,
            )

        try:
            parsed = yaml.safe_load(content)
        except yaml.YAMLError:
            return self._delegate_import(
                account=account,
                import_mode=import_mode,
                yaml_content=yaml_content,
                yaml_url=yaml_url,
                name=name,
                description=description,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
                app_id=app_id,
            )

        if not isinstance(parsed, dict) or parsed.get("kind") != "claude-workflow":
            return self._delegate_import(
                account=account,
                import_mode=import_mode,
                yaml_content=yaml_content,
                yaml_url=yaml_url,
                name=name,
                description=description,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
                app_id=app_id,
            )

        try:
            document = parse_claude_workflow_document(parsed)
        except ClaudeWorkflowSchemaValidationError as exc:
            raise ClaudeWorkflowImportExecutionError(
                status_code=400,
                payload=_failed_import_payload(_format_schema_error(exc)),
            ) from exc

        try:
            compiled_yaml = compile_claude_workflow_to_dify_dsl(document)
        except ClaudeWorkflowCompilerError as exc:
            raise ClaudeWorkflowImportExecutionError(
                status_code=422,
                payload=_failed_import_payload(str(exc)),
            ) from exc

        return self._delegate_import(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=compiled_yaml,
            yaml_url=None,
            name=name,
            description=description,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
            app_id=app_id,
        )

    def _delegate_import(
        self,
        *,
        account: Account,
        import_mode: str,
        yaml_content: str | None,
        yaml_url: str | None,
        name: str | None,
        description: str | None,
        icon_type: str | None,
        icon: str | None,
        icon_background: str | None,
        app_id: str | None,
    ) -> Import:
        return self._dsl_service.import_app(
            account=account,
            import_mode=import_mode,
            yaml_content=yaml_content,
            yaml_url=yaml_url,
            name=name,
            description=description,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
            app_id=app_id,
        )

    def _load_yaml_content(self, *, import_mode: str, yaml_content: str | None, yaml_url: str | None) -> str | None:
        try:
            mode = ImportMode(import_mode)
        except ValueError:
            return None

        if mode == ImportMode.YAML_CONTENT:
            return yaml_content

        if mode != ImportMode.YAML_URL or not yaml_url:
            return None

        try:
            parsed_url = urlparse(yaml_url)
            if (
                parsed_url.scheme == "https"
                and parsed_url.netloc == "github.com"
                and parsed_url.path.endswith((".yml", ".yaml"))
                and "/blob/" in parsed_url.path
            ):
                yaml_url = yaml_url.replace("https://github.com", "https://raw.githubusercontent.com")
                yaml_url = yaml_url.replace("/blob/", "/")
            response = ssrf_proxy.get(yaml_url.strip(), follow_redirects=True, timeout=(10, 10))
            response.raise_for_status()
            content = response.content.decode()
        except Exception:
            return None

        if len(content) > DSL_MAX_SIZE:
            return None

        return content


def _failed_import_payload(error: str) -> Import:
    return Import(
        id=str(uuid.uuid4()),
        status=ImportStatus.FAILED,
        error=error,
    )


def _format_schema_error(exc: ClaudeWorkflowSchemaValidationError) -> str:
    first_issue = exc.errors[0]
    path = ".".join(str(part) for part in first_issue.path)
    return f"{path}: {first_issue.message}"
