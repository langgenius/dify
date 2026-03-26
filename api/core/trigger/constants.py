from typing import Final

TRIGGER_WEBHOOK_NODE_TYPE: Final[str] = "trigger-webhook"
TRIGGER_SCHEDULE_NODE_TYPE: Final[str] = "trigger-schedule"
TRIGGER_PLUGIN_NODE_TYPE: Final[str] = "trigger-plugin"

TRIGGER_NODE_TYPES: Final[frozenset[str]] = frozenset(
    {
        TRIGGER_WEBHOOK_NODE_TYPE,
        TRIGGER_SCHEDULE_NODE_TYPE,
        TRIGGER_PLUGIN_NODE_TYPE,
    }
)


def is_trigger_node_type(node_type: str) -> bool:
    return node_type in TRIGGER_NODE_TYPES
