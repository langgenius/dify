from __future__ import annotations

from collections.abc import Iterator
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline import rag_pipeline as module
from controllers.console.datasets.rag_pipeline.rag_pipeline import (
    CustomizedPipelineTemplateApi,
    PipelineTemplateDetailApi,
    PipelineTemplateListApi,
    PublishCustomizedPipelineTemplateApi,
)
from models.account import Account
from models.dataset import PipelineCustomizedTemplate
from models.engine import db
from services.entities.knowledge_entities.rag_pipeline_entities import PipelineTemplateInfoEntity


def _template_item() -> dict[str, object]:
    return {
        "id": "template-1",
        "name": "Template",
        "icon": {"icon": "book", "icon_type": "emoji", "icon_background": "#fff"},
        "description": "Description",
        "position": 1,
        "chunk_structure": "general",
    }


def _template_detail() -> dict[str, object]:
    return {
        "id": "template-1",
        "name": "Template",
        "icon_info": {"icon": "book", "icon_type": "emoji", "icon_background": "#fff"},
        "description": "Description",
        "chunk_structure": "general",
        "export_data": "dsl: value",
        "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}},
    }


def _payload() -> dict[str, object]:
    return {
        "name": "Updated template",
        "description": "Updated description",
        "icon_info": {"icon": "book", "icon_type": "emoji", "icon_background": "#fff"},
    }


def _account() -> Account:
    account = Account(name="Test User", email="test@example.com")
    account.id = "account-1"
    return account


@pytest.fixture
def database_app() -> Iterator[Flask]:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    db.init_app(app)

    with app.app_context():
        PipelineCustomizedTemplate.__table__.create(db.engine)
        yield app


class TestPipelineTemplateListApi:
    def test_get_uses_query_defaults_and_serializes_nullable_fields(self, app: Flask, sqlite_engine: Engine) -> None:
        api = PipelineTemplateListApi()
        method = unwrap(api.get)
        tenant_id = "tenant-1"
        service_calls: list[tuple[str, str, str]] = []

        def get_pipeline_templates(*, type: str, language: str, current_tenant_id: str, session) -> dict[str, object]:
            del session
            service_calls.append((type, language, current_tenant_id))
            return {"pipeline_templates": [_template_item()]}

        with (
            Session(sqlite_engine) as session,
            app.test_request_context("/rag/pipeline/templates"),
            patch.object(module.RagPipelineService, "get_pipeline_templates", side_effect=get_pipeline_templates),
        ):
            response, status = method(api, session, tenant_id)

        assert status == 200
        assert service_calls == [("built-in", "en-US", tenant_id)]
        assert response == {
            "pipeline_templates": [
                {
                    **_template_item(),
                    "copyright": None,
                    "privacy_policy": None,
                }
            ]
        }

    def test_get_passes_explicit_query_to_service(self, app: Flask, sqlite_engine: Engine) -> None:
        api = PipelineTemplateListApi()
        method = unwrap(api.get)
        tenant_id = "tenant-1"
        service_calls: list[tuple[str, str, str]] = []

        def get_pipeline_templates(*, type: str, language: str, current_tenant_id: str, session) -> dict[str, object]:
            del session
            service_calls.append((type, language, current_tenant_id))
            return {"pipeline_templates": []}

        with (
            Session(sqlite_engine) as session,
            app.test_request_context("/rag/pipeline/templates?type=customized&language=ja-JP"),
            patch.object(module.RagPipelineService, "get_pipeline_templates", side_effect=get_pipeline_templates),
        ):
            response, status = method(api, session, tenant_id)

        assert status == 200
        assert response == {"pipeline_templates": []}
        assert service_calls == [("customized", "ja-JP", tenant_id)]


class TestPipelineTemplateDetailApi:
    def test_get_serializes_template_detail(self, app: Flask, sqlite_engine: Engine) -> None:
        api = PipelineTemplateDetailApi()
        method = unwrap(api.get)
        service_calls: list[tuple[str, str]] = []

        def get_pipeline_template_detail(template_id: str, type: str, *, session) -> dict[str, object]:
            del session
            service_calls.append((template_id, type))
            return _template_detail()

        with (
            Session(sqlite_engine) as session,
            app.test_request_context("/rag/pipeline/templates/template-1?type=customized"),
            patch.object(
                module.RagPipelineService,
                "get_pipeline_template_detail",
                side_effect=get_pipeline_template_detail,
            ),
        ):
            response, status = method(api, session, "template-1")

        assert status == 200
        assert response == {**_template_detail(), "created_by": None}
        assert service_calls == [("template-1", "customized")]

    def test_get_raises_not_found_without_custom_response_body(self, app: Flask, sqlite_engine: Engine) -> None:
        api = PipelineTemplateDetailApi()
        method = unwrap(api.get)

        def get_pipeline_template_detail(template_id: str, type: str, *, session) -> None:
            del template_id, type, session

        with (
            Session(sqlite_engine) as session,
            app.test_request_context("/rag/pipeline/templates/missing"),
            patch.object(
                module.RagPipelineService,
                "get_pipeline_template_detail",
                side_effect=get_pipeline_template_detail,
            ),
            pytest.raises(NotFound),
        ):
            method(api, session, "missing")


class TestCustomizedPipelineTemplateApi:
    def test_patch_validates_payload_and_returns_empty_204(self, app: Flask) -> None:
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.patch)
        payload = _payload()
        account = _account()
        tenant_id = "tenant-1"
        service_calls: list[tuple[str, PipelineTemplateInfoEntity, Account, str]] = []

        def update_template(
            template_id: str,
            template_info: PipelineTemplateInfoEntity,
            current_user: Account,
            current_tenant_id: str,
            *,
            session,
        ) -> None:
            del session
            service_calls.append((template_id, template_info, current_user, current_tenant_id))

        with (
            app.test_request_context("/rag/pipeline/customized/templates/template-1", method="PATCH", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(module.RagPipelineService, "update_customized_pipeline_template", side_effect=update_template),
        ):
            response, status = method(api, tenant_id, account, "template-1")

        assert (response, status) == ("", 204)
        assert len(service_calls) == 1
        template_id, template_info, current_user, current_tenant_id = service_calls[0]
        assert template_id == "template-1"
        assert current_user is account
        assert current_tenant_id == tenant_id
        assert template_info.name == "Updated template"
        assert template_info.description == "Updated description"
        assert template_info.icon_info.model_dump() == {
            "icon": "book",
            "icon_background": "#fff",
            "icon_type": "emoji",
            "icon_url": None,
        }

    def test_patch_defaults_missing_icon_info_before_service_call(self, app: Flask) -> None:
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.patch)
        payload: dict[str, object] = {
            "name": "Updated template",
            "description": "Updated description",
        }
        account = _account()
        tenant_id = "tenant-1"
        service_calls: list[tuple[str, PipelineTemplateInfoEntity, Account, str]] = []

        def update_template(
            template_id: str,
            template_info: PipelineTemplateInfoEntity,
            current_user: Account,
            current_tenant_id: str,
            *,
            session,
        ) -> None:
            del session
            service_calls.append((template_id, template_info, current_user, current_tenant_id))

        with (
            app.test_request_context("/rag/pipeline/customized/templates/template-1", method="PATCH", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(module.RagPipelineService, "update_customized_pipeline_template", side_effect=update_template),
        ):
            response, status = method(api, tenant_id, account, "template-1")

        assert (response, status) == ("", 204)
        assert len(service_calls) == 1
        template_id, template_info, current_user, current_tenant_id = service_calls[0]
        assert template_id == "template-1"
        assert current_user is account
        assert current_tenant_id == tenant_id
        assert template_info.icon_info.model_dump() == {
            "icon": "",
            "icon_background": None,
            "icon_type": None,
            "icon_url": None,
        }

    def test_delete_returns_empty_204(self, app: Flask) -> None:
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.delete)
        tenant_id = "tenant-1"
        deleted_templates: list[tuple[str, str]] = []

        def delete_template(template_id: str, current_tenant_id: str, *, session) -> None:
            del session
            deleted_templates.append((template_id, current_tenant_id))

        with (
            app.test_request_context("/rag/pipeline/customized/templates/template-1", method="DELETE"),
            patch.object(module.RagPipelineService, "delete_customized_pipeline_template", side_effect=delete_template),
        ):
            response, status = method(api, tenant_id, "template-1")

        assert (response, status) == ("", 204)
        assert deleted_templates == [("template-1", tenant_id)]

    @pytest.mark.parametrize("sqlite_session", [(PipelineCustomizedTemplate,)], indirect=True)
    def test_post_exports_yaml_from_orm_template(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
    ) -> None:
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.post)
        template = PipelineCustomizedTemplate(
            tenant_id="00000000-0000-0000-0000-000000000001",
            name="Template",
            description="Description",
            chunk_structure="general",
            icon={"icon": "book", "icon_type": "emoji", "icon_background": "#fff"},
            position=1,
            yaml_content="dsl: value",
            install_count=0,
            language="en-US",
            created_by="00000000-0000-0000-0000-000000000002",
        )
        template.id = "template-1"
        sqlite_session.add(template)
        sqlite_session.commit()
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=sqlite_engine))

        with app.test_request_context("/rag/pipeline/customized/templates/template-1", method="POST"):
            response, status = method(api, "template-1")

        assert status == 200
        assert response == {"data": "dsl: value"}

    @pytest.mark.parametrize("sqlite_session", [(PipelineCustomizedTemplate,)], indirect=True)
    def test_post_raises_when_template_is_missing(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
    ) -> None:
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.post)
        assert sqlite_session.get(PipelineCustomizedTemplate, "missing") is None
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=sqlite_engine))

        with app.test_request_context("/rag/pipeline/customized/templates/missing", method="POST"):
            with pytest.raises(ValueError, match="Customized pipeline template not found"):
                method(api, "missing")


class TestPublishCustomizedPipelineTemplateApi:
    def test_post_validates_payload_and_returns_empty_204(self, app: Flask) -> None:
        api = PublishCustomizedPipelineTemplateApi()
        method = unwrap(api.post)
        payload = _payload()
        account = _account()
        tenant_id = "tenant-1"
        service_calls: list[tuple[str, dict[str, object], Account, str]] = []

        class Service:
            def __init__(self, *args, **kwargs) -> None:
                pass

            def publish_customized_pipeline_template(
                self,
                pipeline_id: str,
                data: dict[str, object],
                current_user: Account,
                current_tenant_id: str,
                *,
                session,
            ) -> None:
                del session
                service_calls.append((pipeline_id, data, current_user, current_tenant_id))

        with (
            app.test_request_context("/rag/pipelines/pipeline-1/customized/publish", method="POST", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(module, "RagPipelineService", Service),
        ):
            response, status = method(api, tenant_id, account, "pipeline-1")

        assert (response, status) == ("", 204)
        assert service_calls == [("pipeline-1", payload, account, tenant_id)]

    def test_post_allows_missing_icon_info_for_publish_service_fallback(self, app: Flask) -> None:
        api = PublishCustomizedPipelineTemplateApi()
        method = unwrap(api.post)
        payload: dict[str, object] = {
            "name": "Published template",
            "description": "Description",
        }
        account = _account()
        tenant_id = "tenant-1"
        service_calls: list[tuple[str, dict[str, object], Account, str]] = []

        class Service:
            def __init__(self, *args, **kwargs) -> None:
                pass

            def publish_customized_pipeline_template(
                self,
                pipeline_id: str,
                data: dict[str, object],
                current_user: Account,
                current_tenant_id: str,
                *,
                session,
            ) -> None:
                del session
                service_calls.append((pipeline_id, data, current_user, current_tenant_id))

        with (
            app.test_request_context("/rag/pipelines/pipeline-1/customized/publish", method="POST", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(module, "RagPipelineService", Service),
        ):
            response, status = method(api, tenant_id, account, "pipeline-1")

        assert (response, status) == ("", 204)
        assert service_calls == [
            (
                "pipeline-1",
                {
                    **payload,
                    "icon_info": {
                        "icon": "",
                        "icon_background": None,
                        "icon_type": None,
                        "icon_url": None,
                    },
                },
                account,
                tenant_id,
            )
        ]
