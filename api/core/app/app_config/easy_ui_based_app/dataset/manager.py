import uuid
from typing import Literal, cast

from core.app.app_config.entities import (
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    MetadataFilteringCondition,
    ModelConfig,
)
from core.entities.agent_entities import PlanningStrategy
from models.model import AppMode
from services.dataset_service import DatasetService


class DatasetConfigManager:
    @classmethod
    def convert(cls, config: dict) -> DatasetEntity | None:
        """
        Convert model config to model config

        :param config: model config args
        """
        dataset_ids = []
        if "datasets" in config.get("dataset_configs", {}):
            datasets = config.get("dataset_configs", {}).get("datasets", {"strategy": "router", "datasets": []})

            for dataset in datasets.get("datasets", []):
                keys = list(dataset.keys())
                if len(keys) == 0 or keys[0] != "dataset":
                    continue

                dataset = dataset["dataset"]

                if "enabled" not in dataset or not dataset["enabled"]:
                    continue

                dataset_id = dataset.get("id", None)
                if dataset_id:
                    dataset_ids.append(dataset_id)

        if (
            "agent_mode" in config
            and config["agent_mode"]
            and "enabled" in config["agent_mode"]
            and config["agent_mode"]["enabled"]
        ):
            agent_dict = config.get("agent_mode", {})

            for tool in agent_dict.get("tools", []):
                keys = tool.keys()
                if len(keys) == 1:
                    # old standard
                    key = list(tool.keys())[0]

                    if key != "dataset":
                        continue

                    tool_item = tool[key]

                    if "enabled" not in tool_item or not tool_item["enabled"]:
                        continue

                    dataset_id = tool_item["id"]
                    dataset_ids.append(dataset_id)

        if len(dataset_ids) == 0:
            return None

        # dataset configs
        if "dataset_configs" in config and config.get("dataset_configs"):
            dataset_configs = config.get("dataset_configs")
        else:
            dataset_configs = {"retrieval_model": "multiple"}
        if dataset_configs is None:
            return None
        query_variable = config.get("dataset_query_variable")

        metadata_model_config_dict = dataset_configs.get("metadata_model_config")
        metadata_filtering_conditions_dict = dataset_configs.get("metadata_filtering_conditions")

        if dataset_configs["retrieval_model"] == "single":
            return DatasetEntity(
                dataset_ids=dataset_ids,
                retrieve_config=DatasetRetrieveConfigEntity(
                    query_variable=query_variable,
                    retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.value_of(
                        dataset_configs["retrieval_model"]
                    ),
                    metadata_filtering_mode=cast(
                        Literal["disabled", "automatic", "manual"],
                        dataset_configs.get("metadata_filtering_mode", "disabled"),
                    ),
                    metadata_model_config=ModelConfig(**metadata_model_config_dict)
                    if isinstance(metadata_model_config_dict, dict)
                    else None,
                    metadata_filtering_conditions=MetadataFilteringCondition(**metadata_filtering_conditions_dict)
                    if isinstance(metadata_filtering_conditions_dict, dict)
                    else None,
                ),
            )
        else:
            score_threshold_val = dataset_configs.get("score_threshold")
            reranking_model_val = dataset_configs.get("reranking_model")
            weights_val = dataset_configs.get("weights")

            return DatasetEntity(
                dataset_ids=dataset_ids,
                retrieve_config=DatasetRetrieveConfigEntity(
                    query_variable=query_variable,
                    retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.value_of(
                        dataset_configs["retrieval_model"]
                    ),
                    top_k=int(dataset_configs.get("top_k", 4)),
                    score_threshold=float(score_threshold_val)
                    if dataset_configs.get("score_threshold_enabled", False) and score_threshold_val is not None
                    else None,
                    reranking_model=reranking_model_val if isinstance(reranking_model_val, dict) else None,
                    weights=weights_val if isinstance(weights_val, dict) else None,
                    reranking_enabled=bool(dataset_configs.get("reranking_enabled", True)),
                    rerank_mode=dataset_configs.get("reranking_mode", "reranking_model"),
                    metadata_filtering_mode=cast(
                        Literal["disabled", "automatic", "manual"],
                        dataset_configs.get("metadata_filtering_mode", "disabled"),
                    ),
                    metadata_model_config=ModelConfig(**metadata_model_config_dict)
                    if isinstance(metadata_model_config_dict, dict)
                    else None,
                    metadata_filtering_conditions=MetadataFilteringCondition(**metadata_filtering_conditions_dict)
                    if isinstance(metadata_filtering_conditions_dict, dict)
                    else None,
                ),
            )

    @classmethod
    def validate_and_set_defaults(cls, tenant_id: str, app_mode: AppMode, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for dataset feature

        :param tenant_id: tenant ID
        :param app_mode: app mode
        :param config: app model config args
        """
        # Extract dataset config for legacy compatibility
        config = cls.extract_dataset_config_for_legacy_compatibility(tenant_id, app_mode, config)

        # dataset_configs
        if "dataset_configs" not in config or not config.get("dataset_configs"):
            config["dataset_configs"] = {}
        config["dataset_configs"]["retrieval_model"] = config["dataset_configs"].get("retrieval_model", "single")

        if not isinstance(config["dataset_configs"], dict):
            raise ValueError("dataset_configs must be of object type")

        if "datasets" not in config["dataset_configs"] or not config["dataset_configs"].get("datasets"):
            config["dataset_configs"]["datasets"] = {"strategy": "router", "datasets": []}

        need_manual_query_datasets = config.get("dataset_configs", {}).get("datasets", {}).get("datasets")

        if need_manual_query_datasets and app_mode == AppMode.COMPLETION:
            # Only check when mode is completion
            dataset_query_variable = config.get("dataset_query_variable")

            if not dataset_query_variable:
                raise ValueError("Dataset query variable is required when dataset is exist")

        return config, ["agent_mode", "dataset_configs", "dataset_query_variable"]

    @classmethod
    def extract_dataset_config_for_legacy_compatibility(cls, tenant_id: str, app_mode: AppMode, config: dict):
        """
        Extract dataset config for legacy compatibility

        :param tenant_id: tenant ID
        :param app_mode: app mode
        :param config: app model config args
        """
        # Extract dataset config for legacy compatibility
        if "agent_mode" not in config or not config.get("agent_mode"):
            config["agent_mode"] = {}

        if not isinstance(config["agent_mode"], dict):
            raise ValueError("agent_mode must be of object type")

        # enabled
        if "enabled" not in config["agent_mode"] or not config["agent_mode"]["enabled"]:
            config["agent_mode"]["enabled"] = False

        if not isinstance(config["agent_mode"]["enabled"], bool):
            raise ValueError("enabled in agent_mode must be of boolean type")

        # tools
        if "tools" not in config["agent_mode"] or not config["agent_mode"].get("tools"):
            config["agent_mode"]["tools"] = []

        if not isinstance(config["agent_mode"]["tools"], list):
            raise ValueError("tools in agent_mode must be a list of objects")

        # strategy
        if "strategy" not in config["agent_mode"] or not config["agent_mode"].get("strategy"):
            config["agent_mode"]["strategy"] = PlanningStrategy.ROUTER

        has_datasets = False
        if config.get("agent_mode", {}).get("strategy") in {
            PlanningStrategy.ROUTER,
            PlanningStrategy.REACT_ROUTER,
        }:
            for tool in config.get("agent_mode", {}).get("tools", []):
                key = list(tool.keys())[0]
                if key == "dataset":
                    # old style, use tool name as key
                    tool_item = tool[key]

                    if "enabled" not in tool_item or not tool_item["enabled"]:
                        tool_item["enabled"] = False

                    if not isinstance(tool_item["enabled"], bool):
                        raise ValueError("enabled in agent_mode.tools must be of boolean type")

                    if "id" not in tool_item:
                        raise ValueError("id is required in dataset")

                    try:
                        uuid.UUID(tool_item["id"])
                    except ValueError:
                        raise ValueError("id in dataset must be of UUID type")

                    if not cls.is_dataset_exists(tenant_id, tool_item["id"]):
                        raise ValueError("Dataset ID does not exist, please check your permission.")

                    has_datasets = True

        need_manual_query_datasets = has_datasets and config.get("agent_mode", {}).get("enabled")

        if need_manual_query_datasets and app_mode == AppMode.COMPLETION:
            # Only check when mode is completion
            dataset_query_variable = config.get("dataset_query_variable")

            if not dataset_query_variable:
                raise ValueError("Dataset query variable is required when dataset is exist")

        return config

    @classmethod
    def is_dataset_exists(cls, tenant_id: str, dataset_id: str) -> bool:
        # verify if the dataset ID exists
        dataset = DatasetService.get_dataset(dataset_id)

        if not dataset:
            return False

        if dataset.tenant_id != tenant_id:
            return False

        return True
