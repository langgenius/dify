import json
from typing import Any
from uuid import NAMESPACE_URL, uuid5

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.model import App, AppAnnotationSetting, AppMode, AppModelConfig
from repositories.app_definition_query_repository import (
    AppDefinitionQueryRepository,
    _get_public_agent_parameter_config,
)


def _stable_uuid(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def _app_model(*, tenant_id: str, app_model_config: AppModelConfig | None = None) -> App:
    return App(
        id=_stable_uuid(f"app:{tenant_id}"),
        tenant_id=tenant_id,
        name="Agent App",
        mode=AppMode.AGENT,
        app_model_config_id=app_model_config.id if app_model_config else None,
    )


def _persist_agent(
    session: Session,
    *,
    tenant_id: str,
    agent_id: str,
    active_config_snapshot_id: str | None,
    active_config_is_published: bool,
    app_id: str | None = None,
) -> Agent:
    agent = Agent(
        id=agent_id,
        tenant_id=tenant_id,
        name="Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id=active_config_snapshot_id,
        active_config_is_published=active_config_is_published,
        app_id=app_id,
    )
    session.add(agent)
    session.commit()
    return agent


def _persist_snapshot(
    session: Session,
    *,
    snapshot_id: str,
    tenant_id: str,
    agent_id: str,
    config_snapshot: dict[str, Any],
    publish_visible: bool = True,
) -> AgentConfigSnapshot:
    snapshot = AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        version=1,
        home_snapshot_id=_stable_uuid(f"home-snapshot:{snapshot_id}"),
        config_snapshot=config_snapshot,
    )
    session.add(snapshot)
    if publish_visible:
        _persist_publish_revision(
            session,
            snapshot_id=snapshot_id,
            tenant_id=tenant_id,
            agent_id=agent_id,
            commit=False,
        )
    session.commit()
    return snapshot


def _persist_publish_revision(
    session: Session,
    *,
    snapshot_id: str,
    tenant_id: str,
    agent_id: str,
    commit: bool = True,
) -> None:
    session.add(
        AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_snapshot_id=snapshot_id,
            revision=1,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    if commit:
        session.commit()


def test_get_public_parameter_config_loads_agent_snapshot(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id = _stable_uuid("tenant:repository")
    app_id = _stable_uuid("app:repository")
    agent_id = _stable_uuid("agent:repository")
    snapshot_id = _stable_uuid("snapshot:repository")
    with sqlite_session_factory() as session:
        session.add(
            App(
                id=app_id,
                tenant_id=tenant_id,
                name="Agent App",
                description="",
                mode=AppMode.AGENT,
                icon_type=None,
                icon=None,
                icon_background=None,
                enable_site=True,
                enable_api=True,
                max_active_requests=None,
            )
        )
        session.commit()
        _persist_agent(
            session,
            tenant_id=tenant_id,
            agent_id=agent_id,
            active_config_snapshot_id=snapshot_id,
            active_config_is_published=True,
            app_id=app_id,
        )
        _persist_snapshot(
            session,
            snapshot_id=snapshot_id,
            tenant_id=tenant_id,
            agent_id=agent_id,
            config_snapshot={"app_variables": [{"name": "topic", "type": "string", "required": True}]},
        )

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_published_parameter_config(
        app_id, public_runtime=True
    )

    assert result is not None
    assert result.user_input_form == [{"text-input": {"label": "topic", "variable": "topic", "required": True}}]


@pytest.mark.parametrize(
    "sqlite_session",
    [(Agent, AgentConfigSnapshot, AgentConfigRevision, AppAnnotationSetting, AppModelConfig)],
    indirect=True,
)
def test_published_agent_app_parameters_use_soul_file_upload(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:one")
    agent_id = _stable_uuid("agent:one")
    snapshot_id = _stable_uuid("snapshot:one")
    app_model_config = AppModelConfig(
        app_id=_stable_uuid(f"app:{tenant_id}"),
        opening_statement="Hi from legacy presentation config",
        file_upload=json.dumps({"enabled": False, "image": {"enabled": False}}),
    )
    sqlite_session.add(app_model_config)
    sqlite_session.commit()
    app_model = _app_model(tenant_id=tenant_id, app_model_config=app_model_config)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=snapshot_id,
        active_config_is_published=True,
        app_id=app_model.id,
    )
    _persist_snapshot(
        sqlite_session,
        snapshot_id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        config_snapshot={
            "app_features": {
                "file_upload": {
                    "enabled": True,
                    "allowed_file_extensions": ["PNG"],
                    "allowed_file_types": ["image"],
                    "allowed_file_upload_methods": ["local_file"],
                    "image": {"enabled": True},
                    "number_limits": 2,
                }
            },
            "app_variables": [{"name": "topic", "type": "string", "required": True}],
        },
    )

    features_dict, user_input_form = _get_public_agent_parameter_config(
        app_model,
        session=sqlite_session,
    )
    parameters = get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)

    assert parameters["opening_statement"] == "Hi from legacy presentation config"
    assert parameters["file_upload"] == {
        "enabled": True,
        "allowed_file_extensions": ["PNG"],
        "allowed_file_types": ["image"],
        "allowed_file_upload_methods": ["local_file"],
        "image": {"enabled": True},
        "number_limits": 2,
    }
    assert parameters["user_input_form"] == [{"text-input": {"label": "topic", "variable": "topic", "required": True}}]


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_requires_bound_agent(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:unbound")
    app_model = _app_model(tenant_id=tenant_id)

    with pytest.raises(AgentAppGeneratorError, match="no bound Agent"):
        _get_public_agent_parameter_config(app_model, session=sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_requires_existing_active_agent(sqlite_session: Session):
    requested_tenant_id = _stable_uuid("tenant:requested")
    agent_id = _stable_uuid("agent:cross-tenant")
    app_model = _app_model(tenant_id=requested_tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=_stable_uuid("tenant:other"),
        agent_id=agent_id,
        active_config_snapshot_id=None,
        active_config_is_published=False,
        app_id=app_model.id,
    )

    with pytest.raises(AgentAppGeneratorError, match="no bound Agent"):
        _get_public_agent_parameter_config(app_model, session=sqlite_session)


@pytest.mark.parametrize("active_config_is_published", [True, False])
@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_requires_published_agent(
    active_config_is_published: bool, sqlite_session: Session
):
    tenant_id = _stable_uuid(f"tenant:published:{active_config_is_published}")
    agent_id = _stable_uuid(f"agent:published:{active_config_is_published}")
    app_model = _app_model(tenant_id=tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=None,
        active_config_is_published=active_config_is_published,
        app_id=app_model.id,
    )

    with pytest.raises(AgentAppNotPublishedError, match="not been published"):
        _get_public_agent_parameter_config(app_model, session=sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_allows_unpublished_draft_with_active_snapshot(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:unpublished-draft")
    agent_id = _stable_uuid("agent:unpublished-draft")
    snapshot_id = _stable_uuid("snapshot:unpublished-draft")
    app_model = _app_model(tenant_id=tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=snapshot_id,
        active_config_is_published=False,
        app_id=app_model.id,
    )
    _persist_snapshot(
        sqlite_session,
        snapshot_id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        config_snapshot={},
    )

    features_dict, user_input_form = _get_public_agent_parameter_config(
        app_model,
        session=sqlite_session,
    )

    assert features_dict["file_upload"]["enabled"] is True
    assert user_input_form == []


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_rejects_seeded_unpublished_snapshot(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:never-published")
    agent_id = _stable_uuid("agent:never-published")
    snapshot_id = _stable_uuid("snapshot:never-published")
    app_model = _app_model(tenant_id=tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=snapshot_id,
        active_config_is_published=False,
        app_id=app_model.id,
    )
    _persist_snapshot(
        sqlite_session,
        snapshot_id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        config_snapshot={},
        publish_visible=False,
    )

    with pytest.raises(AgentAppNotPublishedError, match="not been published"):
        _get_public_agent_parameter_config(app_model, session=sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_requires_published_snapshot(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:missing-snapshot")
    agent_id = _stable_uuid("agent:missing-snapshot")
    app_model = _app_model(tenant_id=tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=_stable_uuid("snapshot:missing"),
        active_config_is_published=True,
        app_id=app_model.id,
    )
    _persist_publish_revision(
        sqlite_session,
        snapshot_id=_stable_uuid("snapshot:missing"),
        tenant_id=tenant_id,
        agent_id=agent_id,
    )

    with pytest.raises(AgentAppGeneratorError, match="published version not found"):
        _get_public_agent_parameter_config(app_model, session=sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_allows_missing_legacy_app_model_config(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:no-legacy-config")
    agent_id = _stable_uuid("agent:no-legacy-config")
    snapshot_id = _stable_uuid("snapshot:no-legacy-config")
    app_model = _app_model(tenant_id=tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=snapshot_id,
        active_config_is_published=True,
        app_id=app_model.id,
    )
    _persist_snapshot(
        sqlite_session,
        snapshot_id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        config_snapshot={},
    )

    features_dict, user_input_form = _get_public_agent_parameter_config(
        app_model,
        session=sqlite_session,
    )

    assert features_dict["file_upload"] == {
        "allowed_file_extensions": ["JPG", "JPEG", "PNG", "GIF", "WEBP", "SVG"],
        "allowed_file_types": ["document", "image", "audio", "video"],
        "allowed_file_upload_methods": ["local_file", "remote_url"],
        "enabled": True,
        "image": {"enabled": True},
        "number_limits": 3,
    }
    assert user_input_form == []
