from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.entities.trace_entity import BaseTraceInfo
from models import Account, App, TenantAccountJoin


class ConcreteTraceInstance(BaseTraceInstance):
    def __init__(self, trace_config: BaseTracingConfig):
        super().__init__(trace_config)

    def trace(self, trace_info: BaseTraceInfo):
        super().trace(trace_info)


@pytest.fixture
def mock_db_session(monkeypatch):
    mock_session = MagicMock(spec=Session)
    mock_session.__enter__.return_value = mock_session
    mock_session.__exit__.return_value = None

    mock_session_class = MagicMock(return_value=mock_session)

    monkeypatch.setattr("core.ops.base_trace_instance.Session", mock_session_class)
    monkeypatch.setattr("core.ops.base_trace_instance.db", MagicMock())
    return mock_session


def test_get_service_account_with_tenant_app_not_found(mock_db_session):
    mock_db_session.scalar.return_value = None

    config = MagicMock(spec=BaseTracingConfig)
    instance = ConcreteTraceInstance(config)

    with pytest.raises(ValueError, match="App with id some_app_id not found"):
        instance.get_service_account_with_tenant("some_app_id")


def test_get_service_account_with_tenant_no_creator(mock_db_session):
    mock_app = MagicMock(spec=App)
    mock_app.id = "some_app_id"
    mock_app.created_by = None
    mock_db_session.scalar.return_value = mock_app

    config = MagicMock(spec=BaseTracingConfig)
    instance = ConcreteTraceInstance(config)

    with pytest.raises(ValueError, match="App with id some_app_id has no creator"):
        instance.get_service_account_with_tenant("some_app_id")


def test_get_service_account_with_tenant_creator_not_found(mock_db_session):
    mock_app = MagicMock(spec=App)
    mock_app.id = "some_app_id"
    mock_app.created_by = "creator_id"

    # First call to scalar returns app, second returns None (for account)
    mock_db_session.scalar.side_effect = [mock_app, None]

    config = MagicMock(spec=BaseTracingConfig)
    instance = ConcreteTraceInstance(config)

    with pytest.raises(ValueError, match="Creator account with id creator_id not found for app some_app_id"):
        instance.get_service_account_with_tenant("some_app_id")


def test_get_service_account_with_tenant_tenant_not_found(mock_db_session):
    mock_app = MagicMock(spec=App)
    mock_app.id = "some_app_id"
    mock_app.created_by = "creator_id"

    mock_account = MagicMock(spec=Account)
    mock_account.id = "creator_id"

    mock_db_session.scalar.side_effect = [mock_app, mock_account]

    # session.query(TenantAccountJoin).filter_by(...).first() returns None
    mock_db_session.query.return_value.filter_by.return_value.first.return_value = None

    config = MagicMock(spec=BaseTracingConfig)
    instance = ConcreteTraceInstance(config)

    with pytest.raises(ValueError, match="Current tenant not found for account creator_id"):
        instance.get_service_account_with_tenant("some_app_id")


def test_get_service_account_with_tenant_success(mock_db_session):
    mock_app = MagicMock(spec=App)
    mock_app.id = "some_app_id"
    mock_app.created_by = "creator_id"

    mock_account = MagicMock(spec=Account)
    mock_account.id = "creator_id"
    mock_account.set_tenant_id = MagicMock()

    mock_db_session.scalar.side_effect = [mock_app, mock_account]

    mock_tenant_join = MagicMock(spec=TenantAccountJoin)
    mock_tenant_join.tenant_id = "tenant_id"
    mock_db_session.query.return_value.filter_by.return_value.first.return_value = mock_tenant_join

    config = MagicMock(spec=BaseTracingConfig)
    instance = ConcreteTraceInstance(config)

    result = instance.get_service_account_with_tenant("some_app_id")

    assert result == mock_account
    mock_account.set_tenant_id.assert_called_once_with("tenant_id")
