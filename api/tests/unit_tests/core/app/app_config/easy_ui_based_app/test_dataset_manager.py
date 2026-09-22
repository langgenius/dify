import uuid
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.app.app_config.easy_ui_based_app.dataset.manager import DatasetConfigManager
from core.entities.agent_entities import PlanningStrategy
from models.dataset import Dataset
from models.model import AppMode

# ==============================
# Fixtures
# ==============================


@pytest.fixture
def valid_uuid():
    return str(uuid.uuid4())


@pytest.fixture
def base_config(valid_uuid):
    return {
        "dataset_configs": {
            "retrieval_model": "multiple",
            "datasets": {
                "strategy": "router",
                "datasets": [{"dataset": {"id": valid_uuid, "enabled": True}}],
            },
        }
    }


@pytest.fixture
def mock_dataset_service(mocker: MockerFixture, valid_uuid):
    dataset = Dataset(
        id=valid_uuid,
        tenant_id="tenant1",
        name="Test Dataset",
        created_by="account-1",
    )

    mocker.patch(
        "core.app.app_config.easy_ui_based_app.dataset.manager.DatasetService.get_dataset",
        return_value=dataset,
    )


# ==============================
# convert tests
# ==============================


class TestDatasetConfigManagerConvert:
    def test_convert_returns_none_when_no_datasets(self):
        config = {"dataset_configs": {"datasets": {"datasets": []}}}
        result = DatasetConfigManager.convert(config)
        assert result is None

    def test_convert_single_retrieval(self, valid_uuid):
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

        result = DatasetConfigManager.convert(config)
        assert result is not None
        assert result.dataset_ids == [valid_uuid]
        assert result.retrieve_config.query_variable == "query"

    def test_convert_single_with_metadata_configs(self, valid_uuid, mocker: MockerFixture):
        mock_retrieve_config = MagicMock()
        mock_entity = MagicMock()
        mock_entity.dataset_ids = [valid_uuid]
        mock_entity.retrieve_config = mock_retrieve_config

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.ModelConfig",
            return_value={"mock": "model"},
        )
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.MetadataFilteringCondition",
            return_value={"mock": "condition"},
        )
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.DatasetRetrieveConfigEntity",
            return_value=mock_retrieve_config,
        )
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.DatasetEntity",
            return_value=mock_entity,
        )

        config = {
            "dataset_query_variable": "query",
            "dataset_configs": {
                "retrieval_model": "single",
                "metadata_filtering_mode": "manual",
                "metadata_model_config": {"any": "value"},
                "metadata_filtering_conditions": {"any": "value"},
                "datasets": {
                    "strategy": "router",
                    "datasets": [{"dataset": {"id": valid_uuid, "enabled": True}}],
                },
            },
        }
        result = DatasetConfigManager.convert(config)
        assert result.dataset_ids == [valid_uuid]
        assert result.retrieve_config is mock_retrieve_config

    def test_convert_multiple_defaults(self, valid_uuid):
        config = {
            "dataset_configs": {
                "retrieval_model": "multiple",
                "datasets": {
                    "strategy": "router",
                    "datasets": [{"dataset": {"id": valid_uuid, "enabled": True}}],
                },
            }
        }
        result = DatasetConfigManager.convert(config)
        assert result.retrieve_config.top_k == 4
        assert result.retrieve_config.score_threshold is None
        assert result.retrieve_config.reranking_enabled is True

    def test_convert_agent_mode_disabled_tool(self, valid_uuid):
        config = {
            "agent_mode": {
                "enabled": True,
                "tools": [{"dataset": {"id": valid_uuid, "enabled": False}}],
            }
        }
        result = DatasetConfigManager.convert(config)
        assert result is None

    def test_convert_dataset_configs_none(self):
        config = {"dataset_configs": None}
        with pytest.raises(TypeError):
            DatasetConfigManager.convert(config)

    def test_convert_agent_mode_old_style_old_format(self, valid_uuid):
        config = {
            "agent_mode": {
                "enabled": True,
                "tools": [{"dataset": {"id": valid_uuid, "enabled": True}}],
            }
        }
        result = DatasetConfigManager.convert(config)
        assert result.dataset_ids == [valid_uuid]
        assert result.retrieve_config.query_variable is None

    def test_convert_multiple_with_score_threshold(self, valid_uuid):
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

        result = DatasetConfigManager.convert(config)
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
    def test_convert_ignores_invalid_dataset_entries(self, dataset_entry):
        config = {
            "dataset_configs": {
                "retrieval_model": "multiple",
                "datasets": {"strategy": "router", "datasets": [dataset_entry]},
            }
        }
        result = DatasetConfigManager.convert(config)
        assert result is None

    def test_convert_agent_mode_old_style(self, valid_uuid):
        config = {
            "agent_mode": {
                "enabled": True,
                "tools": [{"dataset": {"id": valid_uuid, "enabled": True}}],
            }
        }
        result = DatasetConfigManager.convert(config)
        assert result.dataset_ids == [valid_uuid]


# ==============================
# validate_and_set_defaults tests
# ==============================


class TestValidateAndSetDefaults:
    def test_validate_sets_defaults(self, unbound_session: Session):
        config = {}
        updated, fields = DatasetConfigManager.validate_and_set_defaults(
            "tenant1", AppMode.CHAT, config, unbound_session
        )
        assert "dataset_configs" in updated
        assert updated["dataset_configs"]["retrieval_model"] == "single"
        assert isinstance(fields, list)

    def test_validate_raises_when_dataset_configs_not_dict(self, unbound_session: Session):
        config = {"dataset_configs": "invalid"}
        with pytest.raises(AttributeError):
            DatasetConfigManager.validate_and_set_defaults("tenant1", AppMode.CHAT, config, unbound_session)

    def test_validate_requires_query_variable_in_completion_mode(self, valid_uuid, unbound_session: Session):
        config = {
            "dataset_configs": {
                "datasets": {
                    "strategy": "router",
                    "datasets": [{"dataset": {"id": valid_uuid, "enabled": True}}],
                }
            }
        }
        with pytest.raises(ValueError):
            DatasetConfigManager.validate_and_set_defaults("tenant1", AppMode.COMPLETION, config, unbound_session)


# ==============================
# extract_dataset_config_for_legacy_compatibility tests
# ==============================


class TestExtractDatasetConfig:
    def test_extract_sets_defaults(self, unbound_session: Session):
        config = {}
        result = DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
            "tenant1", AppMode.CHAT, config, unbound_session
        )
        assert "agent_mode" in result
        assert result["agent_mode"]["enabled"] is False
        assert result["agent_mode"]["tools"] == []

    def test_extract_invalid_agent_mode_type(self, unbound_session: Session):
        config = {"agent_mode": "invalid"}
        with pytest.raises(ValueError):
            DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
                "tenant1", AppMode.CHAT, config, unbound_session
            )

    def test_extract_invalid_enabled_type(self, unbound_session: Session):
        config = {"agent_mode": {"enabled": "yes"}}
        with pytest.raises(ValueError):
            DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
                "tenant1", AppMode.CHAT, config, unbound_session
            )

    def test_extract_invalid_tools_type(self, unbound_session: Session):
        config = {"agent_mode": {"enabled": True, "tools": "invalid"}}
        with pytest.raises(ValueError):
            DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
                "tenant1", AppMode.CHAT, config, unbound_session
            )

    def test_extract_invalid_uuid(self, mocker: MockerFixture, unbound_session: Session):
        invalid_uuid = "not-a-uuid"
        config = {
            "agent_mode": {
                "enabled": True,
                "strategy": PlanningStrategy.ROUTER,
                "tools": [{"dataset": {"id": invalid_uuid, "enabled": True}}],
            }
        }
        with pytest.raises(ValueError):
            DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
                "tenant1", AppMode.CHAT, config, unbound_session
            )

    def test_extract_dataset_not_exists(self, valid_uuid, mocker: MockerFixture, unbound_session: Session):
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.DatasetService.get_dataset",
            return_value=None,
        )
        config = {
            "agent_mode": {
                "enabled": True,
                "strategy": PlanningStrategy.ROUTER,
                "tools": [{"dataset": {"id": valid_uuid, "enabled": True}}],
            }
        }
        with pytest.raises(ValueError):
            DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
                "tenant1", AppMode.CHAT, config, unbound_session
            )


# ==============================
# is_dataset_exists tests
# ==============================


class TestIsDatasetExists:
    def test_dataset_exists_true(self, mocker: MockerFixture, valid_uuid, unbound_session: Session):
        dataset = Dataset(
            id=valid_uuid,
            tenant_id="tenant1",
            name="Test Dataset",
            created_by="account-1",
        )
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.DatasetService.get_dataset",
            return_value=dataset,
        )

        assert DatasetConfigManager.is_dataset_exists("tenant1", valid_uuid, unbound_session)

    def test_dataset_exists_false_when_not_found(self, mocker: MockerFixture, valid_uuid, unbound_session: Session):
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.DatasetService.get_dataset",
            return_value=None,
        )
        assert not DatasetConfigManager.is_dataset_exists("tenant1", valid_uuid, unbound_session)

    def test_dataset_exists_false_when_tenant_mismatch(
        self, mocker: MockerFixture, valid_uuid, unbound_session: Session
    ):
        dataset = Dataset(
            id=valid_uuid,
            tenant_id="other",
            name="Other Tenant Dataset",
            created_by="account-2",
        )
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.dataset.manager.DatasetService.get_dataset",
            return_value=dataset,
        )
        assert not DatasetConfigManager.is_dataset_exists("tenant1", valid_uuid, unbound_session)


# ==============================
# extract_dataset_config_for_legacy_compatibility tests
# ==============================


class TestExtractDatasetConfigForLegacyCompatibility:
    def test_skips_empty_tool_entry(self, unbound_session: Session):
        # A malformed empty tool dict in agent_mode.tools must be skipped, not
        # crash with `IndexError` on `list(tool.keys())[0]`. The sibling
        # convert() already guards this with `if len(tool) == 1`.
        config = {
            "agent_mode": {
                "enabled": True,
                "strategy": PlanningStrategy.ROUTER,
                "tools": [{}],
            }
        }

        result = DatasetConfigManager.extract_dataset_config_for_legacy_compatibility(
            "tenant1", AppMode.CHAT, config, unbound_session
        )

        assert result["agent_mode"]["tools"] == [{}]
