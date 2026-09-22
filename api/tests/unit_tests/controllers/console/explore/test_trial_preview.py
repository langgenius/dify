"""Anonymous app previews through HTTP and real SQLite query boundaries."""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, delete, event, select, text, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from sqlalchemy.pool import QueuePool
from werkzeug.test import TestResponse

import controllers.common.fields as fields_module
import controllers.console.explore.trial as trial_module
import controllers.console.wraps as console_wraps
import libs.login as login_module
from controllers.console.app import preview_admission as admission_module
from libs.external_api import ExternalApi
from models import AccountTrialAppRecord, App, AppMode, Tenant, TrialApp
from models.account import TenantStatus
from models.dataset import Dataset
from models.enums import CustomizeTokenStrategy
from models.model import AppModelConfig, IconType, Site
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.app_preview_query_repository import AppPreviewQueryRepository
from repositories.trial_app_repository import TrialAppRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.app_preview_query_service import AppPreviewQueryService
from services.recommended_app_query_service import (
    RecommendedAppCatalogPage,
    RecommendedAppDetailRecord,
    RecommendedAppQueryService,
)

_Endpoint = Literal["parameters", "site", "datasets"]
_CREATED_AT = datetime(2024, 1, 1)
_INPUT_FORM = [{"number": {"label": "Count", "variable": "count", "required": False, "default": 0}}]


@dataclass
class _Catalog:
    engine: Engine
    ids: set[str] = field(default_factory=set)
    calls: list[str] = field(default_factory=list)

    def contains(self, app_id: str) -> bool:
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        self.calls.append(app_id)
        return app_id in self.ids

    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        raise AssertionError(f"Unexpected list request for {language}")

    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        raise AssertionError(f"Unexpected list request for {language}")

    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        raise AssertionError(f"Unexpected detail request for {app_id}")


@dataclass(frozen=True)
class _ApplicationServices:
    app_previews: AppPreviewQueryService
    app_definitions: AppDefinitionQueryService
    recommended_app_queries: RecommendedAppQueryService


@dataclass(frozen=True)
class _Harness:
    app: Flask
    owner: Tenant
    target: App
    listing: TrialApp
    site: Site
    config: AppModelConfig
    dataset: Dataset
    creator_id: str
    factory: sessionmaker[Session]
    engine: Engine
    catalog: _Catalog
    sessions: list[Session]
    signed_icons: list[str]

    def get(self, endpoint: _Endpoint, *, query: str = "", app_id: str | None = None) -> TestResponse:
        response = self.app.test_client().get(f"/trial-apps/{app_id or self.target.id}/{endpoint}{query}")
        assert response.headers["Content-Type"] == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        return response

    def dataset_query(self) -> str:
        return f"?ids={self.dataset.id}"


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> _Harness:
    config_overrides(
        LOGIN_DISABLED=False,
        INIT_PASSWORD="preview-does-not-require-setup",
        UPLOAD_IMAGE_FILE_SIZE_LIMIT=1,
        UPLOAD_VIDEO_FILE_SIZE_LIMIT=2,
        UPLOAD_AUDIO_FILE_SIZE_LIMIT=3,
        UPLOAD_FILE_SIZE_LIMIT=4,
        WORKFLOW_FILE_UPLOAD_LIMIT=5,
    )
    owner = Tenant(name="App owner")
    creator_id = str(uuid4())
    target = App(
        id=str(uuid4()), tenant_id=owner.id, name="Preview", mode=AppMode.CHAT, enable_site=False, enable_api=False
    )
    listing = TrialApp(app_id=target.id, tenant_id=str(uuid4()), trial_limit=0)
    config = AppModelConfig(
        app_id=target.id,
        opening_statement="",
        suggested_questions="[]",
        suggested_questions_after_answer='{"enabled":false}',
        speech_to_text='{"enabled":false}',
        text_to_speech='{"enabled":false,"voice":"","autoPlay":"disabled"}',
        retriever_resource='{"enabled":false}',
        more_like_this='{"enabled":false}',
        sensitive_word_avoidance='{"enabled":false,"type":"","configs":[]}',
        file_upload='{"enabled":false,"number_limits":0}',
        user_input_form=json.dumps(_INPUT_FORM),
    )
    site = Site(
        app_id=target.id,
        title="Preview site",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        icon_type=IconType.IMAGE,
        icon=str(uuid4()),
        icon_background="",
        chat_color_theme="",
        chat_color_theme_inverted=False,
        description=None,
        copyright="",
        privacy_policy=None,
        input_placeholder="",
        custom_disclaimer="",
        show_workflow_steps=False,
        use_icon_as_answer_icon=False,
        prompt_public=False,
    )
    dataset = Dataset(
        tenant_id=owner.id,
        name="Owner dataset",
        description=None,
        permission="only_me",
        data_source_type="upload_file",
        indexing_technique=None,
        created_by=creator_id,
        created_at=_CREATED_AT,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([owner, target, listing, config, site, dataset])
        session.flush()
        target.app_model_config_id = config.id
        session.add(AccountTrialAppRecord(app_id=target.id, account_id=creator_id, count=100))

    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    sessions: list[Session] = []

    @event.listens_for(factory, "after_begin")
    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        assert all(not previous.in_transaction() for previous in sessions)
        assert isinstance(sqlite_engine.pool, QueuePool)
        assert sqlite_engine.pool.checkedout() == 1
        sessions.append(session)

    catalog = _Catalog(sqlite_engine)
    recommendations = RecommendedAppQueryService(
        catalog=catalog, trial_apps=TrialAppRepository(factory), trial_enabled=False
    )
    services = _ApplicationServices(
        app_previews=AppPreviewQueryService(
            apps=AppPreviewQueryRepository(session_factory=factory), is_previewable=recommendations.is_previewable
        ),
        app_definitions=AppDefinitionQueryService(
            definitions=AppDefinitionQueryRepository(session_factory=factory), builtin_icon_url_prefix="/tools/"
        ),
        recommended_app_queries=recommendations,
    )
    signed_icons: list[str] = []

    def sign_icon(file_id: str) -> str:
        assert isinstance(sqlite_engine.pool, QueuePool)
        assert sqlite_engine.pool.checkedout() == 0
        signed_icons.append(file_id)
        return f"https://files.example/{file_id}?sign=preview"

    for module in (trial_module, admission_module):
        monkeypatch.setattr(module, "application_services", lambda: services)
    monkeypatch.setattr(login_module, "current_user", None)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: False)
    monkeypatch.setattr(fields_module.file_helpers, "get_signed_file_url", sign_icon)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    api = ExternalApi(app)
    api.add_resource(trial_module.TrialAppParameterApi, "/trial-apps/<uuid:app_id>/parameters")
    api.add_resource(trial_module.TrialSitApi, "/trial-apps/<uuid:app_id>/site")
    api.add_resource(trial_module.DatasetListApi, "/trial-apps/<uuid:app_id>/datasets")
    return _Harness(
        app,
        owner,
        target,
        listing,
        site,
        config,
        dataset,
        creator_id,
        sqlite_session_factory,
        sqlite_engine,
        catalog,
        sessions,
        signed_icons,
    )


def _assert_error(response: TestResponse, status: int, code: str) -> None:
    assert response.status_code == status, response.get_json()
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert isinstance(body["message"], str)
    assert body["message"]


@pytest.mark.parametrize("endpoint", ["parameters", "site", "datasets"])
@pytest.mark.parametrize("membership", ["trial", "catalog"])
def test_anonymous_preview_ignores_trial_feature_quota_and_setup(
    harness: _Harness, endpoint: _Endpoint, membership: str
) -> None:
    if membership == "catalog":
        with harness.factory.begin() as session:
            session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
        harness.catalog.ids.add(harness.target.id)

    response = harness.get(endpoint, query=harness.dataset_query() if endpoint == "datasets" else "")

    assert response.status_code == 200, response.get_json()
    assert harness.catalog.calls == ([] if membership == "trial" else [harness.target.id])
    with harness.factory() as session:
        assert session.scalar(select(AccountTrialAppRecord.count)) == 100


@pytest.mark.parametrize("endpoint", ["parameters", "site", "datasets"])
@pytest.mark.parametrize("unavailable", ["unlisted", "disabled", "missing"])
def test_preview_rejects_unavailable_apps_before_loading_content(
    harness: _Harness, endpoint: _Endpoint, unavailable: str
) -> None:
    with harness.factory.begin() as session:
        if unavailable == "unlisted":
            session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
        elif unavailable == "disabled":
            session.execute(
                text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"), {"app_id": harness.target.id}
            )
        else:
            session.execute(delete(App).where(App.id == harness.target.id))

    _assert_error(harness.get(endpoint, query=harness.dataset_query()), 404, "app_not_found")
    assert harness.signed_icons == []


def test_parameters_preserve_complete_shape_and_zero_false_empty_values(harness: _Harness) -> None:
    response = harness.get("parameters")
    assert response.status_code == 200, response.get_json()
    assert response.get_json() == {
        "opening_statement": "",
        "suggested_questions": [],
        "suggested_questions_after_answer": {"enabled": False},
        "speech_to_text": {"enabled": False},
        "text_to_speech": {"enabled": False, "voice": "", "autoPlay": "disabled"},
        "retriever_resource": {"enabled": False},
        "annotation_reply": {"enabled": False},
        "more_like_this": {"enabled": False},
        "user_input_form": _INPUT_FORM,
        "sensitive_word_avoidance": {"enabled": False, "type": "", "configs": []},
        "file_upload": {"enabled": False, "number_limits": 0},
        "system_parameters": {
            "image_file_size_limit": 1,
            "video_file_size_limit": 2,
            "audio_file_size_limit": 3,
            "file_size_limit": 4,
            "workflow_file_upload_limit": 5,
        },
    }


def test_missing_parameter_configuration_is_app_unavailable(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(AppModelConfig).where(AppModelConfig.id == harness.config.id))
    _assert_error(harness.get("parameters"), 400, "app_unavailable")


def test_site_preserves_complete_fields_and_signs_after_session_closes(harness: _Harness) -> None:
    response = harness.get("site")
    assert response.status_code == 200, response.get_json()
    assert harness.target.enable_site is False
    assert response.get_json() == {
        "title": "Preview site",
        "chat_color_theme": "",
        "chat_color_theme_inverted": False,
        "icon_type": "image",
        "icon": harness.site.icon,
        "icon_background": "",
        "description": None,
        "copyright": "",
        "privacy_policy": None,
        "input_placeholder": "",
        "custom_disclaimer": "",
        "default_language": "en-US",
        "show_workflow_steps": False,
        "use_icon_as_answer_icon": False,
        "icon_url": f"https://files.example/{harness.site.icon}?sign=preview",
    }
    assert harness.signed_icons == [harness.site.icon]


@pytest.mark.parametrize("icon_type", [IconType.EMOJI, None])
def test_non_image_site_icon_has_no_signed_url(harness: _Harness, icon_type: IconType | None) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Site).where(Site.id == harness.site.id).values(icon_type=icon_type, icon=""))
    response = harness.get("site")
    assert response.status_code == 200
    assert response.get_json()["icon_url"] is None
    assert harness.signed_icons == []


@pytest.mark.parametrize(
    ("missing", "code"),
    [("site", "app_site_unavailable"), ("owner", "app_owner_unavailable"), ("archived_owner", "app_owner_unavailable")],
)
def test_site_errors_distinguish_site_and_owner_unavailability(harness: _Harness, missing: str, code: str) -> None:
    with harness.factory.begin() as session:
        if missing == "site":
            session.execute(delete(Site).where(Site.app_id == harness.target.id))
        elif missing == "owner":
            session.execute(delete(Tenant).where(Tenant.id == harness.owner.id))
        else:
            session.execute(update(Tenant).where(Tenant.id == harness.owner.id).values(status=TenantStatus.ARCHIVE))
    _assert_error(harness.get("site"), 403, code)
    assert harness.signed_icons == []


def test_dataset_ids_filter_by_actual_app_owner_without_requiring_binding(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        other_owner = Dataset(
            tenant_id=harness.listing.tenant_id, name="Listing tenant dataset", created_by=harness.creator_id
        )
        unrequested = Dataset(tenant_id=harness.owner.id, name="Not requested", created_by=harness.creator_id)
        session.add_all([other_owner, unrequested])
    response = harness.get(
        "datasets", query=f"?ids={harness.dataset.id}&ids={harness.dataset.id}&ids={other_owner.id}&ids={uuid4()}"
    )
    assert response.status_code == 200, response.get_json()
    assert response.get_json() == {
        "data": [
            {
                "id": harness.dataset.id,
                "name": "Owner dataset",
                "description": None,
                "permission": "only_me",
                "data_source_type": "upload_file",
                "indexing_technique": None,
                "created_by": harness.creator_id,
                "created_at": int(_CREATED_AT.timestamp()),
                "permission_keys": [],
            }
        ],
        "has_more": False,
        "limit": 20,
        "total": 1,
        "page": 1,
    }


@pytest.mark.parametrize(
    ("query", "page", "limit", "has_more"),
    [
        ("&page=0&limit=0", 0, 0, False),
        ("&page=-2&limit=-1", -2, -1, False),
        ("&page=invalid&limit=invalid", 1, 20, False),
        ("&page=99&limit=1", 99, 1, False),
    ],
)
def test_dataset_page_and_limit_are_metadata_without_slicing(
    harness: _Harness, query: str, page: int, limit: int, has_more: bool
) -> None:
    response = harness.get("datasets", query=harness.dataset_query() + query)
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert [item["id"] for item in body["data"]] == [harness.dataset.id]
    assert {key: body[key] for key in ("page", "limit", "total", "has_more")} == {
        "page": page,
        "limit": limit,
        "total": 1,
        "has_more": has_more,
    }


@pytest.mark.parametrize("ids", ["missing", "empty"])
@pytest.mark.parametrize("limit", [20, 0])
def test_unmatched_dataset_ids_return_empty_result(harness: _Harness, ids: str, limit: int) -> None:
    response = harness.get("datasets", query=f"?ids={uuid4() if ids == 'missing' else ''}&limit={limit}")
    assert response.status_code == 200
    assert response.get_json() == {"data": [], "has_more": False, "limit": limit, "total": 0, "page": 1}


def test_dataset_list_requires_ids(harness: _Harness) -> None:
    _assert_error(harness.get("datasets"), 400, "need_add_ids")
