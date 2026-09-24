"""App request contracts and serialization of materialized response data."""

import json
from dataclasses import replace
from datetime import datetime
from pathlib import Path

import pytest
import yaml
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.datastructures import MultiDict

from controllers.console.app import app as controller
from fields import app_fields
from fields.app_model_config_response import AppModelConfigResponse
from libs.pagination import PaginatedResult
from models.account import Account
from models.enums import CustomizeTokenStrategy, TagType
from models.model import App, AppMode, AppModelConfig, IconType, Site, Tag, TagBinding
from models.workflow import Workflow, WorkflowType
from repositories.app.response import app_record
from services.app_service import AppResponseView


@pytest.fixture
def app_module():
    return controller


@pytest.fixture
def app_models(monkeypatch):
    monkeypatch.setattr(
        app_fields, "build_icon_url", lambda kind, icon: f"signed:{icon}" if kind == IconType.IMAGE else None
    )
    return app_fields


def _ts(hour: int = 12) -> datetime:
    return datetime(2024, 1, 1, hour, 0, 0)


TENANT_ID = "00000000-0000-0000-0000-000000000001"
APP_ID = "00000000-0000-0000-0000-000000000101"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000201"
CONFIG_ID = "00000000-0000-0000-0000-000000000301"
WORKFLOW_ID = "00000000-0000-0000-0000-000000000401"
SITE_ID = "00000000-0000-0000-0000-000000000501"
TAG_ID = "00000000-0000-0000-0000-000000000601"


def _account(*, account_id: str = ACCOUNT_ID) -> Account:
    account = Account(name="Creator", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _app(
    *,
    app_id: str = APP_ID,
    tenant_id: str = TENANT_ID,
    name: str = "My App",
    description: str = "Summary",
    mode: AppMode = AppMode.CHAT,
    icon_type: IconType | None = IconType.IMAGE,
    icon: str | None = "icon-key",
    created_at: datetime | None = None,
) -> App:
    timestamp = created_at or _ts()
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name=name,
        description=description,
        mode=mode,
        icon_type=icon_type,
        icon=icon,
        icon_background="#fff",
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
        created_at=timestamp,
        updated_at=timestamp,
    )


def _workflow(*, app_id: str = APP_ID, tenant_id: str = TENANT_ID) -> Workflow:
    return Workflow(
        id=WORKFLOW_ID,
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.CHAT,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": [], "edges": []}),
        features=json.dumps({}),
        created_by=ACCOUNT_ID,
        created_at=_ts(8),
        updated_by=ACCOUNT_ID,
        updated_at=_ts(9),
        environment_variables=[],
        conversation_variables=[],
    )


def _persist_response_graph(session: Session) -> App:
    app = _app(description="Description")
    app.created_by = ACCOUNT_ID
    app.app_model_config_id = CONFIG_ID
    app.workflow_id = WORKFLOW_ID
    app.access_mode = "private"
    app.create_user_name = "Creator"
    app.has_draft_trigger = True
    app.permission_keys = ["app.acl.view_layout"]

    model_config = AppModelConfig(
        app_id=APP_ID,
        model=json.dumps({"provider": "openai", "name": "gpt-4o"}),
        pre_prompt="hello",
        created_by=ACCOUNT_ID,
        updated_by=ACCOUNT_ID,
    )
    model_config.id = CONFIG_ID
    model_config.created_at = _ts(9)
    model_config.updated_at = _ts(10)

    site = Site(
        id=SITE_ID,
        app_id=APP_ID,
        code="site-code",
        title="Public Site",
        icon_type=IconType.IMAGE,
        icon="site-icon",
        icon_background="#fff",
        description="Site description",
        default_language="en-US",
        input_placeholder="Ask anything",
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
    )
    site.created_at = _ts(14)
    site.updated_at = _ts(14)
    tag = Tag(tenant_id=TENANT_ID, type=TagType.APP, name="Utilities", created_by=ACCOUNT_ID)
    tag.id = TAG_ID
    binding = TagBinding(tenant_id=TENANT_ID, tag_id=TAG_ID, target_id=APP_ID, created_by=ACCOUNT_ID)

    session.add_all([_account(), app, model_config, _workflow(), site, tag, binding])
    session.commit()
    return app


def test_app_list_query_reads_repeated_tag_ids(app_module):
    first_tag_id = "8c4ef3d1-58a1-4d94-8a1c-1c171d889e08"
    second_tag_id = "3c39395b-6d1f-4030-8b17-eaa7cc85221c"
    query_args = MultiDict(
        [
            ("page", "1"),
            ("limit", "30"),
            ("tag_ids", first_tag_id),
            ("tag_ids", second_tag_id),
        ]
    )

    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=query_args,
    )

    assert query.tag_ids == [first_tag_id, second_tag_id]


def test_app_list_query_reads_repeated_creator_ids(app_module):
    first_creator_id = "9e8959cf-a67b-4d34-9906-1d687517b248"
    second_creator_id = "1886f96a-5bf0-42bf-961d-8d2129049076"
    query_args = MultiDict(
        [
            ("page", "1"),
            ("limit", "30"),
            ("creator_ids", first_creator_id),
            ("creator_ids", second_creator_id),
        ]
    )

    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=query_args,
    )

    assert query.creator_ids == [first_creator_id, second_creator_id]


def test_app_list_query_preserves_regular_query_params(app_module):
    query_args = MultiDict(
        [
            ("page", "2"),
            ("limit", "50"),
            ("mode", "chat"),
            ("name", "Sales Copilot"),
            ("is_created_by_me", "true"),
        ]
    )

    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=query_args,
    )

    assert query.page == 2
    assert query.limit == 50
    assert query.mode == "chat"
    assert query.name == "Sales Copilot"
    assert query.is_created_by_me is True
    assert query.tag_ids is None


def test_app_list_query_normalizes_empty_repeated_tag_ids_to_none(app_module):
    query_args = MultiDict(
        [
            ("tag_ids", ""),
            ("tag_ids", "   "),
        ]
    )

    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=query_args,
    )

    assert query.tag_ids is None


def test_app_list_query_rejects_invalid_repeated_tag_id(app_module):
    with pytest.raises(ValidationError):
        app_module.query_params_from_request(
            app_module.AppListQuery,
            list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
            args=MultiDict([("tag_ids", "not-a-uuid")]),
        )


def test_app_list_query_rejects_invalid_repeated_creator_id(app_module):
    with pytest.raises(ValidationError):
        app_module.query_params_from_request(
            app_module.AppListQuery,
            list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
            args=MultiDict([("creator_ids", "not-a-uuid")]),
        )


def test_app_list_query_ignores_indexed_tag_ids(app_module):
    tag_id = "8c4ef3d1-58a1-4d94-8a1c-1c171d889e08"
    query_args = MultiDict(
        [
            ("tag_ids[0]", tag_id),
        ]
    )

    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=query_args,
    )

    assert query.tag_ids is None


def test_app_list_query_accepts_single_repeated_tag_id(app_module):
    tag_id = "8c4ef3d1-58a1-4d94-8a1c-1c171d889e08"
    query = app_module.query_params_from_request(
        app_module.AppListQuery,
        list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
        args=MultiDict([("tag_ids", tag_id)]),
    )

    assert query.tag_ids == [tag_id]


def test_create_app_endpoint_rejects_agent_mode(app_module):
    with pytest.raises(ValidationError):
        app_module.CreateAppPayload.model_validate({"name": "Iris", "mode": "agent", "description": "Agent app"})


def test_app_partial_serialization_uses_aliases(app_models, sqlite_session: Session):
    AppPartial = app_models.AppPartial
    app_obj = _persist_response_graph(sqlite_session)
    app_obj.description = "Prompt snippet"

    serialized = AppPartial.model_validate(
        replace(app_record(app_obj, session=sqlite_session), permission_keys=app_obj.permission_keys),
        from_attributes=True,
    ).model_dump(mode="json")

    assert serialized["description"] == "Prompt snippet"
    assert serialized["mode"] == "chat"
    assert serialized["icon_url"] == "signed:icon-key"
    assert serialized["created_at"] == int(app_obj.created_at.timestamp())
    assert serialized["updated_at"] == int(app_obj.updated_at.timestamp())
    assert serialized["model_config"]["model"] == {"provider": "openai", "name": "gpt-4o"}
    assert serialized["workflow"]["id"] == WORKFLOW_ID
    assert serialized["tags"][0]["name"] == "Utilities"
    assert serialized["permission_keys"] == ["app.acl.view_layout"]
    assert "role" not in serialized


def test_app_detail_with_site_includes_nested_serialization(
    app: Flask,
    app_models,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    app_obj = _persist_response_graph(sqlite_session)
    app_obj.name = "Detailed App"
    app_obj.description = "Desc"
    app_obj.mode = AppMode.ADVANCED_CHAT
    app_obj.icon = "detail-icon"
    app_obj.icon_background = "#123456"
    app_obj.use_icon_as_answer_icon = True
    app_obj.max_active_requests = 5
    app_obj.access_mode = "public"
    app_obj.permission_keys = ["app.acl.view_layout", "app.acl.edit"]
    model_config = sqlite_session.get(AppModelConfig, CONFIG_ID)
    assert model_config is not None
    model_config.opening_statement = "hi"
    model_config.retriever_resource = json.dumps({"enabled": True})
    monkeypatch.setattr(
        "repositories.app.response.load_annotation_reply_config", lambda _session, _app_id: {"enabled": False}
    )

    with app.test_request_context("/"):
        response = controller._app_detail_response(
            replace(
                app_record(app_obj, session=sqlite_session, projection="detail-with-site"),
                permission_keys=app_obj.permission_keys,
            ),
        )
        assert isinstance(response, app_models.AppDetailWithSite)
        serialized = response.model_dump(mode="json")

    assert serialized["icon_url"] == "signed:detail-icon"
    assert serialized["model_config"]["retriever_resource"] == {"enabled": True}
    assert serialized["deleted_tools"] == []
    assert serialized["site"]["icon_url"] == "signed:site-icon"
    assert serialized["site"]["input_placeholder"] == "Ask anything"
    assert serialized["site"]["created_at"] == int(_ts(14).timestamp())
    assert serialized["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]
    assert serialized["bound_agent_id"] is None
    assert "role" not in serialized


def test_app_response_view_uses_the_caller_session_for_query_backed_fields(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    app_obj = _persist_response_graph(sqlite_session)
    decoy_tenant_id = "00000000-0000-0000-0000-000000000002"
    decoy_tag = Tag(tenant_id=decoy_tenant_id, type=TagType.APP, name="Decoy", created_by=ACCOUNT_ID)
    decoy_tag.id = "00000000-0000-0000-0000-000000000602"
    sqlite_session.add_all(
        [
            decoy_tag,
            TagBinding(
                tenant_id=decoy_tenant_id,
                tag_id=decoy_tag.id,
                target_id=APP_ID,
                created_by=ACCOUNT_ID,
            ),
        ]
    )
    sqlite_session.commit()
    calls = []

    def load_annotation_reply(session, app_id):
        calls.append((session, app_id))
        return {"enabled": False}

    monkeypatch.setattr("services.app_service.load_annotation_reply_config", load_annotation_reply)

    view = AppResponseView(app_obj, session=sqlite_session)
    site = view.site
    workflow = view.workflow
    model_config = view.app_model_config

    assert view.desc_or_prompt == "Description"
    assert site is not None
    assert site.id == SITE_ID
    assert workflow is not None
    assert workflow.id == WORKFLOW_ID
    assert view.bound_agent_id is None
    assert view.mode_compatible_with_agent == "chat"
    assert view.deleted_tools == []
    assert [tag.name for tag in view.tags] == ["Utilities"]
    assert view.author_name == "Creator"
    assert model_config is not None
    assert model_config.annotation_reply_dict == {"enabled": False}
    assert calls == [(sqlite_session, APP_ID)]


def test_app_pagination_aliases_per_page_and_has_next(app_models, sqlite_session: Session):
    AppPagination = app_models.AppPagination
    item_one = _app(
        app_id="00000000-0000-0000-0000-000000000110",
        name="Paginated One",
        icon="first-icon",
        created_at=_ts(15),
    )
    item_one.permission_keys = ["app.acl.edit"]
    item_two = _app(
        app_id="00000000-0000-0000-0000-000000000111",
        name="Paginated Two",
        mode=AppMode.AGENT_CHAT,
        icon_type=IconType.EMOJI,
        icon="🙂",
        created_at=_ts(16),
    )
    pagination = PaginatedResult(
        page=2,
        per_page=10,
        total=50,
        items=[app_record(item, session=sqlite_session) for item in (item_one, item_two)],
    )

    serialized = AppPagination.model_validate(
        pagination,
        from_attributes=True,
    ).model_dump(mode="json")

    assert serialized["page"] == 2
    assert serialized["limit"] == 10
    assert serialized["has_more"] is True
    assert len(serialized["data"]) == 2
    assert serialized["data"][0]["icon_url"] == "signed:first-icon"
    assert serialized["data"][1]["icon_url"] is None


@pytest.mark.parametrize("strategy", [None, "cot", "function-calling"])
def test_app_detail_preserves_historical_agent_strategy(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, strategy: str | None
):
    app_obj = _persist_response_graph(sqlite_session)
    config = sqlite_session.get(AppModelConfig, CONFIG_ID)
    assert config is not None
    agent_mode = {"enabled": True, "tools": []}
    if strategy is not None:
        agent_mode["strategy"] = strategy
    config.agent_mode = json.dumps(agent_mode)
    sqlite_session.commit()
    monkeypatch.setattr(
        "repositories.app.response.load_annotation_reply_config", lambda _session, _app_id: {"enabled": False}
    )

    with app.test_request_context("/"):
        response = controller._app_detail_response(
            app_record(app_obj, session=sqlite_session, projection="detail-with-site")
        ).model_dump(mode="json")

    assert response["model_config"]["agent_mode"] == agent_mode


def test_app_detail_preserves_historical_agent_mode_without_tools(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    app_obj = _persist_response_graph(sqlite_session)
    app_obj.mode = AppMode.AGENT_CHAT
    config = sqlite_session.get(AppModelConfig, CONFIG_ID)
    assert config is not None
    agent_mode = {"enabled": True, "max_iteration": 5, "strategy": "function_call"}
    config.agent_mode = json.dumps(agent_mode)
    sqlite_session.commit()
    monkeypatch.setattr(
        "repositories.app.response.load_annotation_reply_config", lambda _session, _app_id: {"enabled": False}
    )

    with app.test_request_context("/"):
        response = controller._app_detail_response(
            app_record(app_obj, session=sqlite_session, projection="detail-with-site")
        ).model_dump(mode="json")

    assert response["model_config"]["agent_mode"] == agent_mode


def test_app_model_config_response_round_trips_persisted_dataset_and_external_tool_fields(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    app_obj = _persist_response_graph(sqlite_session)
    config = sqlite_session.get(AppModelConfig, CONFIG_ID)
    assert config is not None
    dataset_configs = {
        "retrieval_model": "multiple",
        "reranking_enable": True,
        "reranking_enabled": True,
        "metadata_filtering_conditions": {
            "logical_operator": "and",
            "conditions": [
                {
                    "id": "condition-1",
                    "metadata_id": "metadata-1",
                    "name": "category",
                    "comparison_operator": "is",
                    "value": "books",
                }
            ],
        },
        "extension_setting": {"value": 1},
    }
    external_form = {
        "external_data_tool": {
            "variable": "customer",
            "label": "Customer",
            "type": "api",
            "enabled": True,
            "icon": "icon-key",
            "icon_background": "#fff",
            "config": {"provider": "crm"},
            "extension_setting": {"value": 2},
        }
    }
    config.dataset_configs = json.dumps(dataset_configs)
    config.user_input_form = json.dumps([external_form])
    sqlite_session.commit()
    monkeypatch.setattr(
        "repositories.app.response.load_annotation_reply_config", lambda _session, _app_id: {"enabled": False}
    )

    with app.test_request_context("/"):
        response = controller._app_detail_response(
            app_record(app_obj, session=sqlite_session, projection="detail-with-site")
        ).model_dump(mode="json")

    model_config = response["model_config"]
    assert model_config["dataset_configs"] == dataset_configs
    assert model_config["user_input_form"] == [external_form]

    reimported = AppModelConfig(app_id=APP_ID)
    reimported.from_model_config_dict(model_config)
    assert reimported.dataset_configs_dict == dataset_configs
    assert reimported.user_input_form_list == [external_form]


def test_recommended_app_model_configs_keep_all_published_fields():
    catalog_path = Path(__file__).resolve().parents[5] / "constants" / "recommended_apps.json"
    catalog = json.loads(catalog_path.read_text())

    def assert_fields_preserved(source, serialized):
        if isinstance(source, dict):
            for key, value in source.items():
                assert key in serialized
                assert_fields_preserved(value, serialized[key])
        elif isinstance(source, list):
            assert len(source) == len(serialized)
            for value, serialized_value in zip(source, serialized, strict=True):
                assert_fields_preserved(value, serialized_value)
        else:
            assert serialized == source

    for entry in catalog["app_details"].values():
        source = yaml.safe_load(entry["export_data"]).get("model_config") or {}
        if not source:
            continue
        payload = {**source, "created_by": None, "created_at": 1, "updated_by": None, "updated_at": 1}
        response = AppModelConfigResponse.model_validate(payload).model_dump(mode="json")
        assert_fields_preserved(source, response)


def test_app_detail_rejects_invalid_known_configuration_fields(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    app_obj = _persist_response_graph(sqlite_session)
    monkeypatch.setattr(
        "repositories.app.response.load_annotation_reply_config", lambda _session, _app_id: {"enabled": False}
    )
    with app.test_request_context("/"):
        detail = controller._app_detail_response(
            app_record(app_obj, session=sqlite_session, projection="detail-with-site")
        ).model_dump(mode="json")

    for field in ("mode", "permission_keys", "site", "model_config"):
        with pytest.raises(ValidationError):
            app_fields.AppDetailWithSite.model_validate({key: value for key, value in detail.items() if key != field})

    with pytest.raises(ValidationError):
        app_fields.AppDetailWithSite.model_validate({**detail, "mode": "unsupported"})

    config = detail["model_config"]
    for invalid in (
        {"speech_to_text": {"enabled": "not-a-boolean"}},
        {"agent_mode": {"enabled": True, "strategy": "unsupported", "tools": []}},
        {"agent_mode": {"enabled": True, "tools": "not-a-list"}},
        {"agent_mode": {"enabled": True, "tools": [{"provider_id": "only-id"}]}},
        {"dataset_configs": {"retrieval_model": "unsupported"}},
        {"dataset_configs": {"retrieval_model": "multiple", "reranking_mode": "unsupported"}},
        {"model": {"provider": "openai", "name": "gpt-4o", "mode": "unsupported"}},
        {"user_input_form": [{"unsupported": {"label": "Name", "variable": "name"}}]},
    ):
        with pytest.raises(ValidationError):
            app_fields.AppDetailWithSite.model_validate({**detail, "model_config": {**config, **invalid}})
