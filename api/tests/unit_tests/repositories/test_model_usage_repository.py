"""Exercise the model-usage document prefilter with real short-lived SQLite Sessions."""

import json

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.model import AppMode, AppModelConfig
from repositories.model_usage_repository import SQLAlchemyModelUsageRepository
from services.model_provider.usage_query import ModelUsageSource
from tests.helpers.unit.model_factories import make_app, make_workflow

WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"
OTHER_WORKSPACE_ID = "11111111-1111-4111-8111-111111111112"


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyModelUsageRepository:
    return SQLAlchemyModelUsageRepository(session_factory=sqlite_session_factory)


def _seed(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as session:
        for app_id, workspace_id, text in [
            ("22222222-2222-4222-8222-222222222221", WORKSPACE_ID, "langgenius/openai/openai gpt-4o"),
            ("22222222-2222-4222-8222-222222222222", WORKSPACE_ID, "langgenius/deepseek/deepseek gpt-4o"),
            ("22222222-2222-4222-8222-222222222223", WORKSPACE_ID, "langgenius/openai/openai gpt-4.1"),
            ("22222222-2222-4222-8222-222222222224", OTHER_WORKSPACE_ID, "langgenius/openai/openai gpt-4o"),
        ]:
            session.add(make_app(app_id=app_id, tenant_id=workspace_id, name=app_id, mode=AppMode.WORKFLOW))
            session.add(make_workflow(tenant_id=workspace_id, app_id=app_id, graph=json.dumps({"note": text})))
        config = AppModelConfig(
            app_id="33333333-3333-4333-8333-333333333331", model='{"name": "gpt-4o", "provider": "openai"}'
        )
        session.add(config)
        session.flush()
        session.add(
            make_app(
                app_id="33333333-3333-4333-8333-333333333331",
                tenant_id=WORKSPACE_ID,
                name="chat",
                app_model_config_id=config.id,
            )
        )
        session.commit()


def test_returns_only_workspace_documents_containing_model_and_provider_fragments(
    repository: SQLAlchemyModelUsageRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _seed(sqlite_session_factory)

    documents = repository.list_documents(
        workspace_id=WORKSPACE_ID, model_fragments=("gpt-4o",), provider_fragment="openai"
    )

    assert sorted((document.app_id, document.source) for document in documents) == [
        ("22222222-2222-4222-8222-222222222221", ModelUsageSource.WORKFLOW_DRAFT),
        ("33333333-3333-4333-8333-333333333331", ModelUsageSource.APP_MODEL_CONFIG),
    ]


def test_ignores_rows_outside_the_app_owner_chain(
    repository: SQLAlchemyModelUsageRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    workflow_app_id = "44444444-4444-4444-8444-444444444441"
    chat_app_id = "44444444-4444-4444-8444-444444444442"
    published_app_id = "44444444-4444-4444-8444-444444444444"
    with sqlite_session_factory() as session:
        # A config row owned by another app, a workflow row of another workspace, and a published workflow of
        # another app, each pointing at one of our apps.
        foreign_published = make_workflow(
            tenant_id=WORKSPACE_ID,
            app_id="44444444-4444-4444-8444-444444444445",
            version="2026-01-01 00:00:00",
            graph='{"note": "openai gpt-4o"}',
        )
        session.add(foreign_published)
        session.add(
            make_app(
                app_id=published_app_id,
                tenant_id=WORKSPACE_ID,
                name="published",
                mode=AppMode.WORKFLOW,
                workflow_id=foreign_published.id,
            )
        )
        foreign_config = AppModelConfig(
            app_id="44444444-4444-4444-8444-444444444443", model='{"name": "gpt-4o", "provider": "openai"}'
        )
        session.add(foreign_config)
        session.flush()
        session.add(make_app(app_id=workflow_app_id, tenant_id=WORKSPACE_ID, name="flow", mode=AppMode.WORKFLOW))
        session.add(
            make_workflow(tenant_id=OTHER_WORKSPACE_ID, app_id=workflow_app_id, graph='{"note": "openai gpt-4o"}')
        )
        session.add(
            make_app(app_id=chat_app_id, tenant_id=WORKSPACE_ID, name="chat", app_model_config_id=foreign_config.id)
        )
        session.commit()

    assert (
        repository.list_documents(workspace_id=WORKSPACE_ID, model_fragments=("gpt-4o",), provider_fragment="openai")
        == []
    )


def test_treats_like_wildcards_in_fragments_literally(
    repository: SQLAlchemyModelUsageRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _seed(sqlite_session_factory)

    assert (
        repository.list_documents(workspace_id=WORKSPACE_ID, model_fragments=("gpt_4%",), provider_fragment="openai")
        == []
    )
