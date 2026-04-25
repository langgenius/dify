from typing import TypedDict, Required

EVENT_META_KEY = "_meta"


class EventMeta(TypedDict, total=False):
    emit_ts: Required[float]
    tenant_id: Required[str]
    app_id: str
    workflow_run_id: str
