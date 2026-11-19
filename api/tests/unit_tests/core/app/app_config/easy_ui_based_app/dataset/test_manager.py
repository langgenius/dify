import uuid
from collections.abc import Mapping
from typing import cast

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.app.app_config.easy_ui_based_app.dataset.manager import DatasetConfigManager
from core.app.app_config.entities import MetadataFilteringCondition, ModelConfig
from core.entities.agent_entities import PlanningStrategy
from models.dataset import Dataset
from models.model import AppMode, AppModelConfigDict


def _app_model_config(config: Mapping[str, object]) -> AppModelConfigDict:
    """App model configs are JSON loaded from the database; these tests build partial ones."""
    return cast(AppModelConfigDict, config)


# ==============================
# Fixtures
# ==============================


@pytest.fixture
def valid_uuid() -> str:
    return str(uuid.uuid4())


# ==============================
# convert tests
# ==============================


class TestDatasetConfigManagerConvert:
    def test_convert_returns_none_when_no_datasets(self) -> None:
        config = {"dataset_configs": {"datasets": {"datasets": list[object]()}}}
        result = DatasetConfigManager.convert(_app_model_config(config))
        assert result is None

    def test_convert_single_retrieval(self, valid_uuid: str) -> None:
        config = {
            "dataset_query_variable": "query",
            "dataset_configs": {
                "retrieval_model": "single",
                "datasets": {
                    "strategy": "router",
                    "datasets": [{"dataset": {"id": valid_uuid, "enabled": True}}],
                },
            },
        }

        result = DatasetConfigManager.convert(_app_model_config(config))
        assert result is not None
        assert result.dataset_ids == [valid_uuid]
        assert result.retrieve_config.query_variable == "query"

    def test_convert_single_with_metadata_configs(self, valid_uuid: str) -> None:
        config = {
            "dataset_query_variable": "query",
            "dataset_configs": {
                "retrieval_model": "single",
                "metadata_filtering_mode": "manual",
                "metadata_model_config": {"provider": "openai", "name": "gpt-4o", "mode": "chat"},
                "metadata_filtering_conditions": {"logical_operator": "or", "conditions": list[object]()},
                "datasets": {
                    "strategy": "router",
                    "datasets": [{"dataset": {"id": valid_uuid, "enabled": True}}],
                },
            },
        }
        result = DatasetConfigManager.convert(_app_model_config(config))
        assert result is not None
        assert result.dataset_ids == [valid_uuid]
        assert result.retrieve_config.query_variable == "query"
        assert result.retrieve_config.metadata_filtering_mode == "manual"
        assert result.retrieve_config.metadata_model_config == ModelConfig(
            provider="openai", name="gpt-4o", mode="chat"
        )
        assert result.retrieve_config.metadata_filtering_conditions == MetadataFilteringCondition(
            logical_operator="or", conditions=[]
        )

    def test_convert_multiple_defaults(self, valid_uuid: str) -> None:
        config = {
            "dataset_configs": {
                "retrieval_model": "multiple",
                "datasets": {
                    "strategy": "router",
                    "datasets": [{"dataset": {"id": valid_uuid, "enabled": True}}],
                },
            }
        }
        result = DatasetConfigManager.convert(_app_model_config(config))
        assert result is not None
        assert result.retrieve_config.top_k == 4
        assert result.retrieve_config.score_threshold is None
        assert result.retrieve_config.reranking_enabled is True

    def test_convert_agent_mode_disabled_tool(self, valid_uuid: str) -> None:
        config = {
            "agent_mode": {
                "enabled": True,
                "tools": [{"dataset": {"id": valid_uuid, "enabled": False}}],
            }
        }
        result = DatasetConfigManager.convert(_app_model_config(config))
        assert result is None

    def test_convert_dataset_configs_none(self) -> None:
        config: dict[str, object] = {"dataset_configs": None}
        with pytest.raises(TypeError):
            DatasetConfigManager.convert(_app_model_config(config))

    def test_convert_agent_mode_old_style_old_format(self, valid_uuid: str) -> None:
        config = {
            "agent_mode": {
                "enabled": True,
                "tools": [{"dataset": {"id": valid_uuid, "enabled": True}}],
            }
        }
        result = DatasetConfigManager.convert(_app_model_config(config))
        assert result is not None
        assert result.dataset_ids == [valid_uuid]
        assert result.retrieve_config.query_variable is None

    def test_convert_multiple_with_score_threshold(self, valid_uuid: str) -> None:
        config = {
            "dataset_query_variable": "query",
            "dataset_configs": {
                "retrieval_model": "multiple",
                "top_k": 5,
                "score_threshold": 0.8,
                "score_threshold_enabled": True,
                "datasets": {
                    "strategy": "router",
                    "datasets": [{"dataset": {"id": valid_uuid, "enabled": True}}],
                },
            },
        }

        result = DatasetConfigManager.convert(_app_model_config(config))
        assert result is not None
        assert result.retrieve_config.top_k == 5
        assert result.retrieve_config.score_threshold == 0.8

    @pytest.mark.parametrize(
        "dataset_entry",
        [
            {},
            {"invalid": {}},
            {"dataset": {"id": None, "enabled": True}},
            {"dataset": {"id": "", "enabled": False}},
        ],
    )
    def test_convert_ignores_invalid_dataset_entries(self, dataset_entry: dict[str, object]) -> None:
        config = {
            "dataset_configs": {
                "retrieval_model": "multiple",
                "datasets": {"strategy": "router", "datasets": [dataset_entry]},
            }
        }
        result = DatasetConfigManager.convert(_app_model_config(config))
        assert result is None

    def test_convert_agent_mode_old_style(self, valid_uuid: str) -> None:
        config = {
            "agent_mode": {
                "enabled": True,
                "tools": [{"dataset": {"id": valid_uuid, "enabled": True}}],
            }
        }
        result = DatasetConfigManager.convert(_app_model_config(config))
        assert result is not None
        assert result.dataset_ids == [valid_uuid]


# ==============================
# validate_and_set_defaults tests
# ==============================


class TestValidateAndSetDefaults:
    def test_validate_sets_defaults(self, unbound_session: Session) -> None:
        config = {}
        updated, fields = DatasetConfigManager.validate_and_set_defaults(
            "tenant1", AppMode.CHAT, config, unbound_session
        )
        assert "dataset_configs" in updated
        assert updated["dataset_configs"]["retrieval_model"] == "single"
        assert isinstance(fields, list)

    def test_validate_raises_when_dataset_configs_not_dict(self, unbound_session: Session) -> None:
        config = {"dataset_configs": "invalid"}
        with pytest.raises(AttributeError):
            DatasetConfigManager.validate_and_set_defaults("tenant1", AppMode.CHAT, config, unbound_session)

    def test_validate_requires_query_variable_in_completion_mode(
        self, valid_uuid: str, unbound_session: Session
    ) -> None:
        config = {
            "dataset_configs": {
                "datasets": {
                    "strategy": "router",
                    "datasets": [{"dataset": {"id": valid_uuid, "enabled": True}}],
                }
            }
        }
        with pytest.raises(ValueError, match="Dataset query variable is required when dataset is exist"):
            DatasetConfigManager.validate_and_set_defaults("tenant1", AppMode.COMPLETION, config, unbound_session)


# ==============================
# extract_dataset_config_for_legacy_compatibility tests
# ==============================


class TestExtractDatasetConfig:
    def test_extract_sets_defaults(self, unbound_session: Session) -> None:
        config = {}
        result = DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
            "tenant1", AppMode.CHAT, config, unbound_session
        )
        assert "agent_mode" in result
        assert result["agent_mode"]["enabled"] is False
        assert result["agent_mode"]["tools"] == []

    def test_extract_invalid_agent_mode_type(self, unbound_session: Session) -> None:
        config = {"agent_mode": "invalid"}
        with pytest.raises(ValueError, match="agent_mode must be of object type"):
            DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
                "tenant1", AppMode.CHAT, config, unbound_session
            )

    def test_extract_invalid_enabled_type(self, unbound_session: Session) -> None:
        config = {"agent_mode": {"enabled": "yes"}}
        with pytest.raises(ValueError, match="enabled in agent_mode must be of boolean type"):
            DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
                "tenant1", AppMode.CHAT, config, unbound_session
            )

    def test_extract_invalid_tools_type(self, unbound_session: Session) -> None:
        config = {"agent_mode": {"enabled": True, "tools": "invalid"}}
        with pytest.raises(ValueError, match="tools in agent_mode must be a list of objects"):
            DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
                "tenant1", AppMode.CHAT, config, unbound_session
            )

    def test_extract_invalid_uuid(self, unbound_session: Session) -> None:
        invalid_uuid = "not-a-uuid"
        config = {
            "agent_mode": {
                "enabled": True,
                "strategy": PlanningStrategy.ROUTER,
                "tools": [{"dataset": {"id": invalid_uuid, "enabled": True}}],
            }
        }
        with pytest.raises(ValueError, match="id in dataset must be of UUID type"):
            DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
                "tenant1", AppMode.CHAT, config, unbound_session
            )

    def test_extract_dataset_not_exists(self, valid_uuid: str, mocker: MockerFixture, unbound_session: Session) -> None:
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.get_dataset_for_tenant",
            return_value=None,
        )
        config = {
            "agent_mode": {
                "enabled": True,
                "strategy": PlanningStrategy.ROUTER,
                "tools": [{"dataset": {"id": valid_uuid, "enabled": True}}],
            }
        }
        with pytest.raises(ValueError, match="Dataset ID does not exist, please check your permission\\."):
            DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
                "tenant1", AppMode.CHAT, config, unbound_session
            )


# ==============================
# is_dataset_exists tests
# ==============================


class TestIsDatasetExists:
    def test_dataset_exists_true(self, mocker: MockerFixture, valid_uuid: str, unbound_session: Session) -> None:
        dataset = Dataset(
            id=valid_uuid,
            tenant_id="tenant1",
            name="Test Dataset",
            created_by="account-1",
        )
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.get_dataset_for_tenant",
            return_value=dataset,
        )

        assert DatasetConfigManager.is_dataset_exists("tenant1", valid_uuid, unbound_session)

    def test_dataset_exists_false_when_not_found(
        self, mocker: MockerFixture, valid_uuid: str, unbound_session: Session
    ) -> None:
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.get_dataset_for_tenant",
            return_value=None,
        )
        assert not DatasetConfigManager.is_dataset_exists("tenant1", valid_uuid, unbound_session)

    def test_dataset_exists_false_when_tenant_mismatch(
        self, mocker: MockerFixture, valid_uuid: str, unbound_session: Session
    ) -> None:
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.get_dataset_for_tenant",
            return_value=None,
        )
        assert not DatasetConfigManager.is_dataset_exists("tenant1", valid_uuid, unbound_session)


# ==============================
# extract_dataset_config_for_legacy_compatibility tests
# ==============================


class TestExtractDatasetConfigForLegacyCompatibility:
    def test_skips_empty_tool_entry(self, unbound_session: Session) -> None:
        # A malformed empty tool dict in agent_mode.tools must be skipped, not
        # crash with `IndexError` on `list(tool.keys())[0]`. The sibling
        # convert() already guards this with `if len(tool) == 1`.
        config = {
            "agent_mode": {
                "enabled": True,
                "strategy": PlanningStrategy.ROUTER,
                "tools": [dict[str, object]()],
            }
        }

        result = DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
            "tenant1", AppMode.CHAT, config, unbound_session
        )

        assert result["agent_mode"]["tools"] == [{}]
