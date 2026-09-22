from collections.abc import Iterator

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from controllers.console.datasets.error import PipelineNotFoundError
from controllers.console.datasets.wraps import get_rag_pipeline, load_rag_pipeline
from extensions.ext_database import db
from models.account import Account
from models.dataset import Pipeline


@pytest.fixture
def database_session(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> Iterator[scoped_session[Session]]:
    """Install a real scoped SQLite session for the legacy decorator entrypoint."""
    session = scoped_session(sqlite_session_factory)
    monkeypatch.setattr(db, "session", session)
    yield session
    session.remove()


@pytest.fixture
def current_account() -> Account:
    account = Account(name="Test User", email="test@example.com")
    account.id = "account-1"
    return account


class TestGetRagPipeline:
    def test_missing_pipeline_id(self):
        @get_rag_pipeline
        def dummy_view(**kwargs):
            return "ok"

        with pytest.raises(ValueError, match="missing pipeline_id"):
            dummy_view()

    def test_pipeline_not_found(
        self,
        mocker: MockerFixture,
        database_session: scoped_session[Session],
        current_account: Account,
    ):
        @get_rag_pipeline
        def dummy_view(**kwargs):
            return "ok"

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(current_account, "tenant-1"),
        )

        get_pipeline_by_id = mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=None,
        )

        with pytest.raises(PipelineNotFoundError):
            dummy_view(pipeline_id="pipeline-1")
        get_pipeline_by_id.assert_called_once_with("pipeline-1", "tenant-1", session=database_session())

    def test_pipeline_found_and_injected(
        self,
        mocker: MockerFixture,
        database_session: scoped_session[Session],
        current_account: Account,
    ):
        pipeline = Pipeline(
            tenant_id="tenant-1",
            name="Test Pipeline",
        )
        pipeline.id = "pipeline-1"

        @get_rag_pipeline
        def dummy_view(**kwargs):
            return kwargs["pipeline"]

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(current_account, "tenant-1"),
        )

        get_pipeline_by_id = mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=pipeline,
        )

        result = dummy_view(pipeline_id="pipeline-1")

        assert result is pipeline
        get_pipeline_by_id.assert_called_once_with("pipeline-1", "tenant-1", session=database_session())

    def test_load_rag_pipeline_uses_provided_session(
        self, mocker: MockerFixture, sqlite_session: Session, current_account: Account
    ):
        pipeline = Pipeline(tenant_id="tenant-id", name="Test Pipeline")

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(current_account, "tenant-1"),
        )
        get_pipeline_by_id = mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=pipeline,
        )

        result = load_rag_pipeline(sqlite_session, "pipeline-1")

        assert result is pipeline
        get_pipeline_by_id.assert_called_once_with("pipeline-1", "tenant-1", session=sqlite_session)

    def test_pipeline_id_removed_from_kwargs(
        self,
        mocker: MockerFixture,
        database_session: scoped_session[Session],
        current_account: Account,
    ):
        pipeline = Pipeline(tenant_id="tenant-id", name="Test Pipeline")

        @get_rag_pipeline
        def dummy_view(**kwargs):
            assert "pipeline_id" not in kwargs
            return "ok"

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(current_account, "tenant-1"),
        )

        mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=pipeline,
        )

        result = dummy_view(pipeline_id="pipeline-1")

        assert result == "ok"
        assert db.session is database_session

    def test_pipeline_id_cast_to_string(
        self,
        mocker: MockerFixture,
        database_session: scoped_session[Session],
        current_account: Account,
    ):
        pipeline = Pipeline(tenant_id="tenant-id", name="Test Pipeline")

        @get_rag_pipeline
        def dummy_view(**kwargs):
            return kwargs["pipeline"]

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(current_account, "tenant-1"),
        )

        get_pipeline_by_id = mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=pipeline,
        )

        result = dummy_view(pipeline_id=123)

        assert result is pipeline
        get_pipeline_by_id.assert_called_once_with("123", "tenant-1", session=database_session())
