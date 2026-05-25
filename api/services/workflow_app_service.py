# Canonical implementation has moved to services.studio.workflow_app_service
# This barrel is kept for backwards compatibility.
from services.studio.workflow_app_service import LogViewDetails, LogView, WorkflowAppService, __init__, details, __getattr__, get_paginate_workflow_app_logs, get_paginate_workflow_archive_logs, handle_trigger_metadata, _safe_json_loads, _safe_parse_uuid

__all__ = ["LogViewDetails",
    "LogView",
    "WorkflowAppService",
    "__init__",
    "details",
    "__getattr__",
    "get_paginate_workflow_app_logs",
    "get_paginate_workflow_archive_logs",
    "handle_trigger_metadata",
    "_safe_json_loads",
    "_safe_parse_uuid"]
