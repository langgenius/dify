from collections.abc import Callable, Iterator
from inspect import unwrap

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from controllers.console.datasets.error import PipelineNotFoundError
from controllers.console.datasets.rag_pipeline.datasource_content_preview import DataSourceContentPreviewApi
from controllers.console.datasets.rag_pipeline.rag_pipeline import PublishCustomizedPipelineTemplateApi
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
    def test_missing_pipeline_id(self) -> None:
        @get_rag_pipeline
        def dummy_view(**_kwargs: object) -> str:
            return "ok"

        with pytest.raises(ValueError, match="missing pipeline_id"):
            dummy_view()

    def test_pipeline_not_found(
        self,
        mocker: MockerFixture,
        database_session: scoped_session[Session],
        current_account: Account,
    ) -> None:
        @get_rag_pipeline
        def dummy_view(**_kwargs: object) -> str:
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
    ) -> None:
        pipeline = Pipeline(
            tenant_id="tenant-1",
            name="Test Pipeline",
        )
        pipeline.id = "pipeline-1"

        @get_rag_pipeline
        def dummy_view(**kwargs: object) -> object:
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
    ) -> None:
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
    ) -> None:
        pipeline = Pipeline(tenant_id="tenant-id", name="Test Pipeline")

        @get_rag_pipeline
        def dummy_view(**kwargs: object) -> str:
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
    ) -> None:
        pipeline = Pipeline(tenant_id="tenant-id", name="Test Pipeline")

        @get_rag_pipeline
        def dummy_view(**kwargs: object) -> object:
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


class _Resource:
    """Stands in for the ``Resource`` instance that ``with_session`` passes as ``self``."""


class TestGetRagPipelineInjectedSession:
    def test_loads_through_the_session_injected_above_it(
        self,
        mocker: MockerFixture,
        database_session: scoped_session[Session],
        sqlite_session: Session,
        current_account: Account,
    ) -> None:
        """``@with_session`` composed above the decorator puts its session at ``args[1]``."""
        pipeline = Pipeline(tenant_id="tenant-1", name="Test Pipeline")

        @get_rag_pipeline
        def dummy_view(_self: _Resource, session: Session, **kwargs: object) -> tuple[Session, object]:
            return session, kwargs["pipeline"]

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(current_account, "tenant-1"),
        )
        get_pipeline_by_id = mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=pipeline,
        )

        result = dummy_view(_Resource(), sqlite_session, pipeline_id="pipeline-1")

        assert result == (sqlite_session, pipeline)
        assert sqlite_session is not database_session()
        get_pipeline_by_id.assert_called_once_with("pipeline-1", "tenant-1", session=sqlite_session)

    def test_falls_back_when_the_slot_holds_another_injected_value(
        self,
        mocker: MockerFixture,
        database_session: scoped_session[Session],
        current_account: Account,
    ) -> None:
        """An unmigrated handler may get an ``Account`` from ``with_current_user`` in that slot."""
        pipeline = Pipeline(tenant_id="tenant-1", name="Test Pipeline")

        @get_rag_pipeline
        def dummy_view(_self: _Resource, current_user: Account, **kwargs: object) -> object:
            assert current_user is current_account
            return kwargs["pipeline"]

        mocker.patch(
            "controllers.console.datasets.wraps.current_account_with_tenant",
            return_value=(current_account, "tenant-1"),
        )
        get_pipeline_by_id = mocker.patch(
            "controllers.console.datasets.wraps.RagPipelineService.get_pipeline_by_id",
            return_value=pipeline,
        )

        assert dummy_view(_Resource(), current_account, pipeline_id="pipeline-1") is pipeline
        get_pipeline_by_id.assert_called_once_with("pipeline-1", "tenant-1", session=database_session())


def _decorator_layers(view: Callable[..., object]) -> list[str]:
    """Name each layer of a decorated view, outermost first.

    ``functools.wraps`` copies ``__qualname__`` onto every wrapper but leaves its
    ``__code__`` alone, so the code object still names the decorator that built it.
    """
    layers: list[str] = []

    def record(layer: Callable[..., object]) -> bool:
        layers.append(layer.__code__.co_qualname.split(".", 1)[0])
        return False

    record(unwrap(view, stop=record))
    return layers


@pytest.mark.parametrize(
    "view",
    [PublishCustomizedPipelineTemplateApi.post, DataSourceContentPreviewApi.post],
    ids=["publish_customized_pipeline_template", "datasource_content_preview"],
)
def test_migrated_handlers_inject_their_session_into_get_rag_pipeline(view: Callable[..., object]) -> None:
    """``with_session`` sits directly above ``get_rag_pipeline``, so the pipeline loads through the
    handler's session instead of ``db.session``."""
    layers = _decorator_layers(view)

    assert layers[layers.index("get_rag_pipeline") - 1] == "with_session"
