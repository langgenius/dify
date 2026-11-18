from collections.abc import Callable, Iterator
from inspect import unwrap
from uuid import uuid4

import pytest
from flask import Flask, g
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, object_session, sessionmaker

from controllers.console.datasets.error import PipelineNotFoundError
from controllers.console.datasets.rag_pipeline.datasource_content_preview import DataSourceContentPreviewApi
from controllers.console.datasets.rag_pipeline.rag_pipeline import PublishCustomizedPipelineTemplateApi
from controllers.console.datasets.rag_pipeline.rag_pipeline_workflow import (
    DraftRagPipelineRunApi,
    PublishedRagPipelineRunApi,
)
from controllers.console.datasets.wraps import (
    get_rag_pipeline,
    load_rag_pipeline,
)
from extensions.ext_database import db
from models.account import Account
from models.dataset import Pipeline
from tests.helpers.unit.model_factories import make_account, make_tenant


class _Resource:
    """Stands in for the ``Resource`` instance that ``with_session`` passes as ``self``."""


def _persist_pipeline(
    session: Session,
    *,
    tenant_id: str,
    name: str = "Test Pipeline",
    pipeline_id: str | None = None,
) -> Pipeline:
    pipeline = Pipeline(tenant_id=tenant_id, name=name, description="")
    if pipeline_id is not None:
        pipeline.id = pipeline_id
    session.add(pipeline)
    session.commit()
    return pipeline


def _committed_name(factory: sessionmaker[Session], pipeline_id: str) -> str:
    """Read the pipeline name from a session other than the one that wrote it."""
    with factory() as other:
        stored = other.get(Pipeline, pipeline_id)
        assert stored is not None
        return stored.name


@pytest.fixture
def scoped_session_app(sqlite_engine: Engine) -> Iterator[Flask]:
    """A Flask app whose ``db.session`` is bound to the pristine test database.

    The production defaults of ``get_rag_pipeline`` read that scoped session, so
    exercising them needs a real application registered with Flask-SQLAlchemy.
    """
    app = Flask(__name__)
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    yield app
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def test_missing_pipeline_id() -> None:
    @get_rag_pipeline
    def dummy_view() -> str:
        return "ok"

    with pytest.raises(ValueError, match="missing pipeline_id"):
        dummy_view()


def test_load_rag_pipeline_reads_the_committed_row(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    tenant_id = str(uuid4())
    pipeline = _persist_pipeline(sqlite_session, tenant_id=tenant_id, name="Stored pipeline")

    loaded = load_rag_pipeline(sqlite_session, pipeline.id, tenant_id=tenant_id)

    assert loaded.id == pipeline.id
    assert loaded.name == "Stored pipeline"
    assert object_session(loaded) is sqlite_session
    assert _committed_name(sqlite_session_factory, pipeline.id) == "Stored pipeline"


def test_load_rag_pipeline_rejects_another_tenants_row(sqlite_session: Session) -> None:
    pipeline = _persist_pipeline(sqlite_session, tenant_id=str(uuid4()))

    with pytest.raises(PipelineNotFoundError):
        load_rag_pipeline(sqlite_session, pipeline.id, tenant_id=str(uuid4()))


def test_load_rag_pipeline_rejects_a_missing_row(sqlite_session: Session) -> None:
    with pytest.raises(PipelineNotFoundError):
        load_rag_pipeline(sqlite_session, str(uuid4()), tenant_id=str(uuid4()))


def test_unmigrated_handler_loads_through_the_scoped_session(scoped_session_app: Flask) -> None:
    """A handler that has not migrated gets its pipeline from the request-scoped session.

    No dependency is patched here: the decorator keeps its production defaults, so
    ``db.session`` and ``current_account_with_tenant`` both run for real.
    """
    tenant = make_tenant()
    account = make_account(tenant=tenant)

    with scoped_session_app.app_context(), scoped_session_app.test_request_context("/"):
        g._login_user = account
        pipeline = _persist_pipeline(db.session(), tenant_id=tenant.id, name="Scoped pipeline")

        @get_rag_pipeline
        def dummy_view(pipeline: Pipeline | None = None, pipeline_id: str = "") -> Pipeline:
            assert pipeline is not None
            assert pipeline_id == ""
            return pipeline

        loaded = dummy_view(pipeline_id=pipeline.id)

        assert loaded.id == pipeline.id
        assert loaded.name == "Scoped pipeline"
        assert object_session(loaded) is db.session()


def test_unmigrated_handler_rejects_another_tenants_row(scoped_session_app: Flask) -> None:
    tenant = make_tenant()
    account = make_account(tenant=tenant)

    with scoped_session_app.app_context(), scoped_session_app.test_request_context("/"):
        g._login_user = account
        pipeline = _persist_pipeline(db.session(), tenant_id=str(uuid4()))

        @get_rag_pipeline
        def dummy_view(pipeline: Pipeline | None = None, pipeline_id: str = "") -> Pipeline:
            assert pipeline_id == ""
            assert pipeline is not None
            return pipeline

        with pytest.raises(PipelineNotFoundError):
            dummy_view(pipeline_id=pipeline.id)


def test_pipeline_id_removed_from_kwargs(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    pipeline = _persist_pipeline(sqlite_session, tenant_id=str(uuid4()))

    @get_rag_pipeline(session_factory=lambda: sqlite_session, resolve_tenant_id=lambda: pipeline.tenant_id)
    def dummy_view(pipeline: Pipeline | None = None, pipeline_id: str = "") -> str:
        assert pipeline is not None
        assert pipeline_id == ""
        return pipeline.name

    assert dummy_view(pipeline_id=pipeline.id) == pipeline.name
    assert _committed_name(sqlite_session_factory, pipeline.id) == pipeline.name


def test_pipeline_id_is_loaded_as_a_string(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    tenant_id = str(uuid4())
    pipeline = _persist_pipeline(sqlite_session, tenant_id=tenant_id, pipeline_id="123")

    @get_rag_pipeline(session_factory=lambda: sqlite_session, resolve_tenant_id=lambda: tenant_id)
    def dummy_view(pipeline: Pipeline | None = None, pipeline_id: str | int = "") -> Pipeline:
        assert pipeline is not None
        assert pipeline_id == ""
        return pipeline

    loaded = dummy_view(pipeline_id=123)

    assert loaded.id == "123"
    assert object_session(loaded) is sqlite_session
    assert _committed_name(sqlite_session_factory, "123") == pipeline.name


def test_loads_through_the_session_injected_above_it(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """``@with_session`` composed above the decorator puts its session at ``args[1]``."""
    pipeline = _persist_pipeline(sqlite_session, tenant_id=str(uuid4()), name="Injected pipeline")

    def unused_session_factory() -> Session:
        raise AssertionError("injected session path must not open the legacy session")

    @get_rag_pipeline(session_factory=unused_session_factory, resolve_tenant_id=lambda: pipeline.tenant_id)
    def dummy_view(
        _self: _Resource,
        session: Session,
        pipeline: Pipeline | None = None,
        pipeline_id: str = "",
    ) -> tuple[Session, Pipeline]:
        assert pipeline is not None
        assert pipeline_id == ""
        return session, pipeline

    handler_session, loaded = dummy_view(_Resource(), sqlite_session, pipeline_id=pipeline.id)

    assert handler_session is sqlite_session
    assert loaded.id == pipeline.id
    assert loaded.name == "Injected pipeline"
    assert object_session(loaded) is sqlite_session
    assert _committed_name(sqlite_session_factory, pipeline.id) == "Injected pipeline"


def test_unmigrated_handler_uses_the_session_factory(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """An unmigrated handler may get an ``Account`` from ``with_current_user`` in that slot."""
    pipeline = _persist_pipeline(sqlite_session, tenant_id=str(uuid4()), name="Legacy pipeline")
    account = Account(name="Test User", email="test@example.com")
    account.id = "account-1"

    @get_rag_pipeline(session_factory=sqlite_session_factory, resolve_tenant_id=lambda: pipeline.tenant_id)
    def dummy_view(
        _self: _Resource,
        current_user: Account,
        pipeline: Pipeline | None = None,
        pipeline_id: str = "",
    ) -> Pipeline:
        assert current_user is account
        assert pipeline is not None
        assert pipeline_id == ""
        return pipeline

    loaded = dummy_view(_Resource(), account, pipeline_id=pipeline.id)
    loaded_session = object_session(loaded)

    assert loaded.id == pipeline.id
    assert loaded.name == "Legacy pipeline"
    assert loaded_session is not None
    assert loaded_session is not sqlite_session
    loaded_session.close()
    assert _committed_name(sqlite_session_factory, pipeline.id) == "Legacy pipeline"


def _decorator_layers[**P, R](view: Callable[P, R]) -> list[str]:
    """Name each layer of a decorated view, outermost first.

    ``functools.wraps`` copies ``__qualname__`` onto every wrapper but leaves its
    ``__code__`` alone, so the code object still names the decorator that built it.
    """
    layers: list[str] = []

    def record(layer: Callable[P, R]) -> bool:
        layers.append(layer.__code__.co_qualname.split(".", 1)[0])
        return False

    record(unwrap(view, stop=record))
    return layers


@pytest.mark.parametrize(
    "view",
    [
        PublishCustomizedPipelineTemplateApi.post,
        DataSourceContentPreviewApi.post,
        DraftRagPipelineRunApi.post,
        PublishedRagPipelineRunApi.post,
    ],
    ids=[
        "publish_customized_pipeline_template",
        "datasource_content_preview",
        "draft_rag_pipeline_run",
        "published_rag_pipeline_run",
    ],
)
def test_migrated_handlers_inject_their_session_into_get_rag_pipeline[**P, R](view: Callable[P, R]) -> None:
    """``with_session`` sits directly above ``get_rag_pipeline``, so the pipeline loads through the
    handler's session."""
    layers = _decorator_layers(view)

    assert layers[layers.index("get_rag_pipeline") - 1] == "with_session"
