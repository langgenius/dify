"""RBACResourceService reads through the session its caller passes in (#37403)."""

from unittest.mock import MagicMock
from uuid import UUID

from sqlalchemy.orm import Session

from services.rbac_resource_service import RBACResourceService


def _session(scalar_result: object = None) -> MagicMock:
    session = MagicMock(spec=Session)
    session.scalar.return_value = scalar_result
    return session


def _bound_params(session: MagicMock) -> set[object]:
    statement = session.scalar.call_args.args[0]
    return set(statement.compile().params.values())


class TestGetAppAgentBinding:
    def test_returns_none_when_app_is_not_in_tenant(self) -> None:
        session = _session(None)

        assert RBACResourceService.get_app_agent_binding(session, "tenant-1", "app-1") is None
        assert {"tenant-1", "app-1"} <= _bound_params(session)

    def test_resolves_the_binding_with_the_same_session(self) -> None:
        binding = object()
        app = MagicMock()
        app.agent_app_binding_with_session.return_value = binding
        session = _session(app)

        assert RBACResourceService.get_app_agent_binding(session, "tenant-1", "app-1") is binding
        app.agent_app_binding_with_session.assert_called_once_with(session=session, include_archived=True)


def test_get_app_maintainer_queries_the_passed_session() -> None:
    session = _session("account-1")

    assert RBACResourceService.get_app_maintainer(session, "tenant-1", "app-1") == "account-1"
    assert {"tenant-1", "app-1", "normal"} <= _bound_params(session)


def test_get_dataset_maintainer_queries_the_passed_session() -> None:
    session = _session("account-2")

    assert RBACResourceService.get_dataset_maintainer(session, "tenant-1", "dataset-1") == "account-2"
    assert {"tenant-1", "dataset-1"} <= _bound_params(session)


class TestGetDatasetIdByPipeline:
    def test_returns_none_when_no_dataset_matches(self) -> None:
        session = _session(None)

        assert RBACResourceService.get_dataset_id_by_pipeline(session, "tenant-1", "pipeline-1") is None
        assert {"tenant-1", "pipeline-1"} <= _bound_params(session)

    def test_returns_the_dataset_id_as_a_string(self) -> None:
        dataset_id = UUID("8f7c7d2e-4b1a-4f7e-9c3d-2a6b5e1f0c9d")
        session = _session(dataset_id)

        assert RBACResourceService.get_dataset_id_by_pipeline(session, "tenant-1", "pipeline-1") == str(dataset_id)
