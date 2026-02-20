# tests/unit_tests/core/workflow/nodes/lim/test_lim_utils.py

from unittest.mock import MagicMock, patch

import pytest

from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.workflow.nodes.llm.exc import (
    InvalidVariableTypeError,
    LLMModeRequiredError,
    ModelNotExistError,
)
from core.workflow.nodes.llm.llm_utils import (
    deduct_llm_quota,
    fetch_files,
    fetch_memory,
    fetch_model_config,
)
from models.provider import ProviderType

# ============================================================
# fetch_model_config
# ============================================================


def build_model_config(mode="chat", completion_params=None):
    cfg = MagicMock()
    cfg.mode = mode
    cfg.provider = "openai"
    cfg.name = "gpt-4"
    cfg.completion_params = completion_params or {}
    return cfg


@patch("core.workflow.nodes.llm.llm_utils.ModelManager")
def test_fetch_model_config_mode_required(mock_manager):
    cfg = build_model_config(mode=None)
    with pytest.raises(LLMModeRequiredError):
        fetch_model_config("tenant", cfg)


@patch("core.workflow.nodes.llm.llm_utils.ModelManager")
def test_fetch_model_config_provider_model_none(mock_manager):
    cfg = build_model_config()

    model = MagicMock()
    model.provider_model_bundle.configuration.get_provider_model.return_value = None
    mock_manager.return_value.get_model_instance.return_value = model

    with pytest.raises(ModelNotExistError):
        fetch_model_config("tenant", cfg)


@patch("core.workflow.nodes.llm.llm_utils.ModelManager")
def test_fetch_model_config_model_schema_none(mock_manager):
    cfg = build_model_config()

    provider_model = MagicMock()
    provider_model.raise_for_status.return_value = None

    model = MagicMock()
    model.provider_model_bundle.configuration.get_provider_model.return_value = provider_model
    model.model_type_instance.get_model_schema.return_value = None

    mock_manager.return_value.get_model_instance.return_value = model

    with pytest.raises(ModelNotExistError):
        fetch_model_config("tenant", cfg)


@patch("core.workflow.nodes.llm.llm_utils.ModelConfigWithCredentialsEntity")
@patch("core.workflow.nodes.llm.llm_utils.ModelManager")
def test_fetch_model_config_with_stop(mock_manager, mock_entity):
    cfg = build_model_config(completion_params={"stop": ["END"], "temp": 0.7})

    provider_model = MagicMock()
    provider_model.raise_for_status.return_value = None

    model = MagicMock()
    model.credentials = {}
    model.provider_model_bundle = MagicMock()
    model.provider_model_bundle.configuration.get_provider_model.return_value = provider_model
    model.model_type_instance.get_model_schema.return_value = MagicMock()

    mock_manager.return_value.get_model_instance.return_value = model
    mock_entity.return_value = MagicMock()

    instance, entity = fetch_model_config("tenant", cfg)

    assert instance == model
    mock_entity.assert_called_once()


@patch("core.workflow.nodes.llm.llm_utils.ModelConfigWithCredentialsEntity")
@patch("core.workflow.nodes.llm.llm_utils.ModelManager")
def test_fetch_model_config_success(mock_manager, mock_entity):
    cfg = build_model_config()

    provider_model = MagicMock()
    provider_model.raise_for_status.return_value = None

    model = MagicMock()
    model.credentials = {}
    model.provider_model_bundle = MagicMock()
    model.provider_model_bundle.configuration.get_provider_model.return_value = provider_model
    model.model_type_instance.get_model_schema.return_value = MagicMock()

    mock_manager.return_value.get_model_instance.return_value = model
    mock_entity.return_value = MagicMock()

    instance, entity = fetch_model_config("tenant", cfg)

    assert instance == model
    mock_entity.assert_called_once()


# ============================================================
# fetch_files
# ============================================================


def test_fetch_files_none():
    pool = MagicMock()
    pool.get.return_value = None
    assert fetch_files(pool, ["a"]) == []


def test_fetch_files_file_segment():
    from core.workflow.nodes.llm import llm_utils

    class FakeFileSegment(llm_utils.FileSegment):
        def __init__(self, value):
            object.__setattr__(self, "value", value)

    fake_file = MagicMock()
    segment = FakeFileSegment(fake_file)

    pool = MagicMock()
    pool.get.return_value = segment

    result = fetch_files(pool, ["a"])

    assert result == [fake_file]


def test_fetch_files_array_file_segment():
    from core.workflow.nodes.llm import llm_utils

    class FakeArrayFileSegment(llm_utils.ArrayFileSegment):
        def __init__(self, value):
            object.__setattr__(self, "value", value)

    f1 = MagicMock()
    f2 = MagicMock()

    segment = FakeArrayFileSegment([f1, f2])

    pool = MagicMock()
    pool.get.return_value = segment

    result = fetch_files(pool, ["a"])

    assert result == [f1, f2]


def test_fetch_files_none_segment():
    from core.variables.segments import NoneSegment

    pool = MagicMock()
    pool.get.return_value = NoneSegment()

    assert fetch_files(pool, ["a"]) == []


def test_fetch_files_array_any_segment():
    from core.variables.segments import ArrayAnySegment

    pool = MagicMock()
    pool.get.return_value = ArrayAnySegment(value=[])

    assert fetch_files(pool, ["a"]) == []


def test_fetch_files_invalid_type():
    pool = MagicMock()
    pool.get.return_value = "invalid"
    with pytest.raises(InvalidVariableTypeError):
        fetch_files(pool, ["a"])


# ============================================================
# fetch_memory
# ============================================================


def test_fetch_memory_no_memory():
    pool = MagicMock()
    assert fetch_memory(pool, "app", None, MagicMock()) is None


def test_fetch_memory_invalid_conversation_id():
    pool = MagicMock()
    pool.get.return_value = MagicMock()  # not StringSegment
    assert fetch_memory(pool, "app", MagicMock(), MagicMock()) is None


@patch("core.workflow.nodes.llm.llm_utils.db")
@patch("core.workflow.nodes.llm.llm_utils.Session")
def test_fetch_memory_conversation_not_found(mock_session, mock_db):
    from core.variables.segments import StringSegment

    pool = MagicMock()
    pool.get.return_value = StringSegment(value="conv1")

    session_instance = MagicMock()
    session_instance.scalar.return_value = None
    mock_session.return_value.__enter__.return_value = session_instance

    mock_db.engine = MagicMock()

    assert fetch_memory(pool, "app", MagicMock(), MagicMock()) is None


@patch("core.workflow.nodes.llm.llm_utils.db")
@patch("core.workflow.nodes.llm.llm_utils.Session")
def test_fetch_memory_success(mock_session, mock_db):
    from core.variables.segments import StringSegment

    pool = MagicMock()
    pool.get.return_value = StringSegment(value="conv1")

    conversation = MagicMock()

    session_instance = MagicMock()
    session_instance.scalar.return_value = conversation
    mock_session.return_value.__enter__.return_value = session_instance

    mock_db.engine = MagicMock()

    memory = fetch_memory(pool, "app", MagicMock(), MagicMock())

    assert memory is not None


# ============================================================
# deduct_llm_quota
# ============================================================


def build_system_model(quota_unit, quota_type, quota_limit=100):
    quota_conf = MagicMock()
    quota_conf.quota_type = quota_type
    quota_conf.quota_unit = quota_unit
    quota_conf.quota_limit = quota_limit

    system_config = MagicMock()
    system_config.quota_configurations = [quota_conf]
    system_config.current_quota_type = quota_type

    provider_config = MagicMock()
    provider_config.using_provider_type = ProviderType.SYSTEM
    provider_config.system_configuration = system_config

    bundle = MagicMock()
    bundle.configuration = provider_config

    model = MagicMock()
    model.provider_model_bundle = bundle
    model.model = "gpt-4"
    model.provider = "openai"

    return model


def test_deduct_llm_quota_not_system():
    model = MagicMock()
    model.provider_model_bundle.configuration.using_provider_type = "non_system"

    deduct_llm_quota("tenant", model, MagicMock())


def test_deduct_llm_quota_unlimited():
    model = build_system_model(QuotaUnit.TOKENS, ProviderQuotaType.TRIAL, quota_limit=-1)
    deduct_llm_quota("tenant", model, MagicMock(total_tokens=100))


@patch("core.workflow.nodes.llm.llm_utils.dify_config")
@patch("services.credit_pool_service.CreditPoolService.check_and_deduct_credits")
def test_deduct_llm_quota_trial_tokens(mock_credit, mock_config):
    model = build_system_model(QuotaUnit.TOKENS, ProviderQuotaType.TRIAL)
    usage = MagicMock(total_tokens=50)

    deduct_llm_quota("tenant", model, usage)
    mock_credit.assert_called_once()


@patch("core.workflow.nodes.llm.llm_utils.dify_config")
@patch("services.credit_pool_service.CreditPoolService.check_and_deduct_credits")
def test_deduct_llm_quota_paid_credits(mock_credit, mock_config):
    model = build_system_model(QuotaUnit.CREDITS, ProviderQuotaType.PAID)
    mock_config.get_model_credits.return_value = 20

    deduct_llm_quota("tenant", model, MagicMock(total_tokens=50))
    mock_credit.assert_called_once()


@patch("core.workflow.nodes.llm.llm_utils.db")
@patch("core.workflow.nodes.llm.llm_utils.Session")
def test_deduct_llm_quota_other_type(mock_session, mock_db):
    # Use a real enum member that is NOT TRIAL or PAID
    other_type = next(q for q in ProviderQuotaType if q not in (ProviderQuotaType.TRIAL, ProviderQuotaType.PAID))

    model = build_system_model(QuotaUnit.TOKENS, other_type)

    # Prevent Flask engine access
    mock_db.engine = MagicMock()

    session_instance = MagicMock()
    mock_session.return_value.__enter__.return_value = session_instance

    deduct_llm_quota("tenant", model, MagicMock(total_tokens=30))

    session_instance.execute.assert_called_once()
    session_instance.commit.assert_called_once()
