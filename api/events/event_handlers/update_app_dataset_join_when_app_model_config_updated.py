from typing import Any, cast

from sqlalchemy.orm import Session

from events.app_event import app_model_config_was_updated
from models.model import AppModelConfig
from repositories.knowledge.dataset_read_repository import sync_app_dataset_joins


@app_model_config_was_updated.connect
def handle(sender, *, session: Session, **kwargs) -> None:
    """Update dataset joins with the caller-provided session."""
    app = sender
    app_model_config = kwargs.get("app_model_config")
    if app_model_config is None:
        return

    dataset_ids = get_dataset_ids_from_model_config(app_model_config)

    sync_app_dataset_joins(
        session,
        tenant_id=app.tenant_id,
        app_id=app.id,
        dataset_ids=dataset_ids,
    )


def get_dataset_ids_from_model_config(app_model_config: AppModelConfig) -> set[str]:
    dataset_ids: set[str] = set()
    if not app_model_config:
        return dataset_ids

    agent_mode = app_model_config.agent_mode_dict

    tools = agent_mode.get("tools", []) or []
    for tool in tools:
        if len(list(tool.keys())) != 1:
            continue

        tool_type = list(tool.keys())[0]
        tool_config = cast(dict[str, Any], list(tool.values())[0])
        if tool_type == "dataset":
            dataset_id = tool_config.get("id")
            if isinstance(dataset_id, str):
                dataset_ids.add(dataset_id)

    # get dataset from dataset_configs
    dataset_configs = app_model_config.dataset_configs_dict
    datasets = dataset_configs.get("datasets", {}) or {}
    for dataset in datasets.get("datasets", []) or []:
        keys = list(dataset.keys())
        if len(keys) == 1 and keys[0] == "dataset":
            if dataset["dataset"].get("id"):
                dataset_ids.add(dataset["dataset"].get("id"))

    return dataset_ids
