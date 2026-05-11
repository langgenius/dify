from collections.abc import Mapping
from typing import Any

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.legacy_system_files import (
    LegacySysFilesCompatVariable,
    attach_legacy_sys_files_warning,
    normalize_legacy_sys_files_args,
)
from models.model import App
from services.app_generate_service import AppGenerateService


def normalize_legacy_system_file_args_for_service_api(
    *,
    app_model: App,
    args: Mapping[str, Any],
    raw_payload: Mapping[str, Any] | None,
    workflow_id: str | None = None,
) -> tuple[Mapping[str, Any], LegacySysFilesCompatVariable | None]:
    # TODO: Remove this hidden Service API compatibility path after all persisted workflows are migrated.
    args_with_hidden_system = _copy_hidden_system_files_arg(args=args, raw_payload=raw_payload)
    if not _has_legacy_file_arg(args_with_hidden_system):
        return args, None

    workflow = AppGenerateService.get_workflow(app_model, InvokeFrom.SERVICE_API, workflow_id)
    return normalize_legacy_sys_files_args(graph=workflow.graph_dict, args=args_with_hidden_system)


def attach_legacy_system_file_warning_for_service_api(
    response: Mapping[str, Any] | Any,
    compat_variable: LegacySysFilesCompatVariable | None,
) -> Mapping[str, Any] | Any:
    # TODO: Remove this warning once Service API clients no longer need the legacy migration notice.
    return attach_legacy_sys_files_warning(response, compat_variable)


def _copy_hidden_system_files_arg(
    *,
    args: Mapping[str, Any],
    raw_payload: Mapping[str, Any] | None,
) -> Mapping[str, Any]:
    system = raw_payload.get("system") if isinstance(raw_payload, Mapping) else None
    if not isinstance(system, Mapping) or "files" not in system or system["files"] is None:
        return args

    copied_args = dict(args)
    copied_args["system"] = {"files": system["files"]}
    return copied_args


def _has_legacy_file_arg(args: Mapping[str, Any]) -> bool:
    if args.get("files") is not None:
        return True

    system = args.get("system")
    return isinstance(system, Mapping) and system.get("files") is not None
