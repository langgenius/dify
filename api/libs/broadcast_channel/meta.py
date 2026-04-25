from typing import TypedDict

EVENT_META_KEY = "_meta"


class EventMeta(TypedDict, total=False):
    emit_ts: float
    tenant_id: str
    app_id: str
    workflow_run_id: str
