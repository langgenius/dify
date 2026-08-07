from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from sqlalchemy.orm import Session

from models.model import TraceAppConfig
from services.ops_service import OpsService


def _trace_config(config_id: str, provider: str) -> MagicMock:
    config = MagicMock(spec=TraceAppConfig)
    config.id = config_id
    config.app_id = "app-1"
    config.tracing_provider = provider
    config.tracing_config = {"secret": "encrypted"}
    return config


def test_get_tracing_app_configs_deduplicates_and_isolates_invalid_config() -> None:
    session = MagicMock(spec=Session)
    first = _trace_config("config-1", "langfuse")
    duplicate = _trace_config("config-2", "langfuse")
    invalid = _trace_config("config-3", "mlflow")
    invalid.tracing_config = None
    unsupported = _trace_config("config-4", "removed-provider")
    session.scalars.return_value.all.return_value = [first, duplicate, invalid, unsupported]
    session.get.return_value = SimpleNamespace(tenant_id="tenant-1")

    serialized: dict[str, object] = {
        "id": first.id,
        "app_id": first.app_id,
        "tracing_provider": first.tracing_provider,
        "tracing_config": {"secret": "********"},
    }

    def serialize(config: TraceAppConfig, _tenant_id: str) -> dict[str, object]:
        if config is invalid:
            raise ValueError("broken encrypted value")
        return serialized

    with patch.object(OpsService, "_serialize_tracing_app_config", side_effect=serialize) as serializer:
        result = OpsService.get_tracing_app_configs("app-1", include_config=True, session=session)

    assert result == {
        "configured_providers": ["langfuse", "mlflow"],
        "configs": [
            serialized,
            {
                "id": "config-3",
                "app_id": "app-1",
                "tracing_provider": "mlflow",
                "error": "config_unavailable",
            },
        ],
    }
    assert serializer.call_args_list == [call(first, "tenant-1"), call(invalid, "tenant-1")]


def test_get_tracing_app_configs_summary_ignores_duplicates_and_unsupported_providers() -> None:
    session = MagicMock(spec=Session)
    session.scalars.return_value.all.return_value = ["langfuse", "langfuse", "removed-provider", None, "mlflow"]

    result = OpsService.get_tracing_app_configs("app-1", include_config=False, session=session)

    assert result == {"configured_providers": ["langfuse", "mlflow"], "configs": None}


def test_update_tracing_app_config_updates_canonical_row_and_removes_duplicates() -> None:
    session = MagicMock(spec=Session)
    first = _trace_config("config-1", "langfuse")
    duplicate = _trace_config("config-2", "langfuse")
    first.to_dict.return_value = {"id": first.id}
    session.scalars.return_value.all.return_value = [first, duplicate]
    session.get.return_value = SimpleNamespace(tenant_id="tenant-1")

    with patch("services.ops_service.OpsTraceManager") as trace_manager:
        trace_manager.encrypt_tracing_config.return_value = {"secret": "encrypted-new"}
        trace_manager.decrypt_tracing_config.return_value = {"secret": "decrypted-new"}
        trace_manager.check_trace_config_is_effective.return_value = True

        result = OpsService.update_tracing_app_config(
            "app-1",
            "langfuse",
            {"secret": "new"},
            session,
        )

    assert result == {"id": "config-1"}
    assert first.tracing_config == {"secret": "encrypted-new"}
    session.delete.assert_called_once_with(duplicate)
    session.commit.assert_called_once_with()


def test_delete_tracing_app_config_removes_all_duplicate_provider_rows() -> None:
    session = MagicMock(spec=Session)
    first = _trace_config("config-1", "langfuse")
    duplicate = _trace_config("config-2", "langfuse")
    session.scalars.return_value.all.return_value = [first, duplicate]

    result = OpsService.delete_tracing_app_config("app-1", "langfuse", session)

    assert result is True
    assert session.delete.call_args_list == [call(first), call(duplicate)]
    session.commit.assert_called_once_with()
