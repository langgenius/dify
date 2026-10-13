"""Legacy feature bridge exercised through real service wiring and SQLite.

Successful embedding searches need a configured provider/vector backend; the
failure path below uses actual backend validation instead of mocking a search.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

import pytest
from flask import Flask
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.annotation_reply.annotation_reply import AnnotationReplyFeature
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from models.dataset import DatasetCollectionBinding
from models.enums import CollectionBindingType, ConversationFromSource
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_app, make_message


@dataclass(frozen=True)
class _Harness:
    factory: sessionmaker[Session]
    app: App
    message: Message
    feature: AnnotationReplyFeature


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    app = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    message = make_message(
        message_id=str(uuid4()),
        app_id=app.id,
        inputs={},
        query="User question",
        message={},
        answer="",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id="user-1",
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([app, message])
    redis = RedisClientWrapper()
    redis.initialize(Redis())
    services = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis,
    )
    flask_app = Flask(__name__)
    flask_app.extensions["application_services"] = services
    with (
        flask_app.app_context(),
        config_overrides_context(
            VECTOR_STORE="annotation-test-uninstalled-vector-backend", VECTOR_STORE_WHITELIST_ENABLE=False
        ),
    ):
        yield _Harness(sqlite_session_factory, app, message, AnnotationReplyFeature())


@pytest.mark.parametrize(
    "invoke_from", [InvokeFrom.SERVICE_API, InvokeFrom.WEB_APP, InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER]
)
def test_disabled_reply_falls_through_without_caller_session(harness: _Harness, invoke_from: InvokeFrom) -> None:
    result = harness.feature.query(
        app_record=harness.app,
        message=harness.message,
        query="hi",
        user_id="user-1",
        invoke_from=invoke_from,
    )

    assert result is None
    with harness.factory() as session:
        assert session.scalar(select(AppAnnotationHitHistory)) is None


def test_backend_failure_falls_through_and_keeps_hit_history_empty(
    harness: _Harness, caplog: pytest.LogCaptureFixture
) -> None:
    binding = DatasetCollectionBinding(
        provider_name="annotation-provider",
        model_name="annotation-embedding",
        type=CollectionBindingType.ANNOTATION,
        collection_name="annotation_collection",
    )
    binding.id = str(uuid4())
    with harness.factory.begin() as session:
        session.add(binding)
        session.add(
            AppAnnotationSetting(
                app_id=harness.app.id,
                score_threshold=0.5,
                collection_binding_id=binding.id,
                created_user_id="user-1",
                updated_user_id="user-1",
            )
        )

    result = harness.feature.query(
        app_record=harness.app,
        message=harness.message,
        query="hi",
        user_id="user-1",
        invoke_from=InvokeFrom.SERVICE_API,
    )

    assert result is None
    assert "Query annotation failed" in caplog.text
    assert "not supported" in caplog.text
    with harness.factory() as session:
        assert session.scalar(select(AppAnnotationHitHistory)) is None


def test_reply_read_uses_app_and_tenant_scope_and_returns_detached_content(harness: _Harness) -> None:
    annotation = MessageAnnotation(
        app_id=harness.app.id, question="Question", content="Answer", account_id="deleted-author"
    )
    with harness.factory.begin() as session:
        session.add(annotation)

    reply = harness.feature.get_reply(
        tenant_id=harness.app.tenant_id, app_id=harness.app.id, annotation_id=annotation.id
    )
    assert reply is not None
    assert (reply.id, reply.content, reply.account_id, reply.account_name) == (
        annotation.id,
        "Answer",
        "deleted-author",
        None,
    )
    assert (
        harness.feature.get_reply(tenant_id="different-tenant", app_id=harness.app.id, annotation_id=annotation.id)
        is None
    )
    assert (
        harness.feature.get_reply(tenant_id=harness.app.tenant_id, app_id="different-app", annotation_id=annotation.id)
        is None
    )
