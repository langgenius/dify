from events.app_event import app_model_config_was_updated
from extensions.ext_database import db
from models.dataset import AppDatasetJoin
from models.model import AppModelConfig


@app_model_config_was_updated.connect
def handle(sender, **kwargs):
    app = sender
    app_model_config = kwargs.get("app_model_config")
    if app_model_config is None:
        return

    dataset_ids = get_dataset_ids_from_model_config(app_model_config)

    app_dataset_joins = db.session.query(AppDatasetJoin).filter(AppDatasetJoin.app_id == app.id).all()

    removed_dataset_ids: set[str] = set()
    if not app_dataset_joins:
        added_dataset_ids = dataset_ids
    else:
        old_dataset_ids: set[str] = set()
        old_dataset_ids.update(app_dataset_join.dataset_id for app_dataset_join in app_dataset_joins)

        added_dataset_ids = dataset_ids - old_dataset_ids
        removed_dataset_ids = old_dataset_ids - dataset_ids

    if removed_dataset_ids:
        for dataset_id in removed_dataset_ids:
            db.session.query(AppDatasetJoin).filter(
                AppDatasetJoin.app_id == app.id, AppDatasetJoin.dataset_id == dataset_id
            ).delete()

    if added_dataset_ids:
        for dataset_id in added_dataset_ids:
            app_dataset_join = AppDatasetJoin(app_id=app.id, dataset_id=dataset_id)
            db.session.add(app_dataset_join)

    db.session.commit()


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
        tool_config = list(tool.values())[0]
        if tool_type == "dataset":
            dataset_ids.add(tool_config.get("id"))

    # get dataset from dataset_configs
    dataset_configs = app_model_config.dataset_configs_dict
    datasets = dataset_configs.get("datasets", {}) or {}
    for dataset in datasets.get("datasets", []) or []:
        keys = list(dataset.keys())
        if len(keys) == 1 and keys[0] == "dataset":
            if dataset["dataset"].get("id"):
                dataset_ids.add(dataset["dataset"].get("id"))

    return dataset_ids
