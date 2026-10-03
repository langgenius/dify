from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, create_autospec

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound

from controllers.console.datasets.rag_pipeline import rag_pipeline as module
from machinery.context import RequestContext
from models.account import TenantAccountRole
from models.dataset import Pipeline
from services.knowledge.dataset_access import DatasetAccessDeniedError
from services.knowledge.pipeline_templates.application import (
    PipelineTemplateInput,
    PipelineTemplateNameConflictError,
    PipelineTemplateNotFoundError,
    PipelineTemplatePublishForbiddenError,
    PipelineTemplateService,
)
from tests.unit_tests.controllers.rbac_introspection import rbac_checks
from tests.unit_tests.model_factories import make_account

CONTEXT = RequestContext("request", None, "account-1", "tenant-1")


def _pipeline() -> Pipeline:
    pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline")
    pipeline.id = "pipeline-1"
    return pipeline


@pytest.fixture
def templates(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    service = create_autospec(PipelineTemplateService, instance=True, spec_set=True)
    registry = SimpleNamespace(knowledge=SimpleNamespace(pipeline_templates=service))
    monkeypatch.setattr(module, "application_services", lambda: registry)
    return service


def test_list_preserves_defaults_and_nullable_fields(app: Flask, templates: MagicMock) -> None:
    item = {
        "id": "template-1",
        "name": "Template",
        "description": "Description",
        "icon": {},
        "position": 1,
        "chunk_structure": "paragraph",
    }
    templates.list_templates.return_value = {"pipeline_templates": [item]}
    api = module.PipelineTemplateListApi()
    with app.test_request_context("/"):
        response, status = unwrap(api.get)(api, module.PipelineTemplateListQuery(), CONTEXT)
    assert status == 200
    assert response == {"pipeline_templates": [{**item, "copyright": None, "privacy_policy": None}]}
    templates.list_templates.assert_called_once_with(CONTEXT, "built-in", "en-US")


def test_list_preserves_customized_language(app: Flask, templates: MagicMock) -> None:
    templates.list_templates.return_value = {"pipeline_templates": []}
    api = module.PipelineTemplateListApi()
    with app.test_request_context("/"):
        response, status = unwrap(api.get)(
            api, module.PipelineTemplateListQuery(type="customized", language="ja-JP"), CONTEXT
        )
    assert (response, status) == ({"pipeline_templates": []}, 200)
    templates.list_templates.assert_called_once_with(CONTEXT, "customized", "ja-JP")


def test_detail_serialization_and_missing_response(app: Flask, templates: MagicMock) -> None:
    detail = {
        "id": "template-1",
        "name": "Template",
        "icon_info": {},
        "description": "Description",
        "chunk_structure": "paragraph",
        "export_data": "dsl: value",
        "graph": {},
    }
    templates.get_template.return_value = detail
    api = module.PipelineTemplateDetailApi()
    with app.test_request_context("/"):
        response, status = unwrap(api.get)(
            api, module.PipelineTemplateDetailQuery(type="customized"), CONTEXT, "template-1"
        )
        assert (response, status) == ({**detail, "created_by": None}, 200)
        templates.get_template.return_value = None
        with pytest.raises(NotFound, match="Pipeline template not found from upstream service"):
            unwrap(api.get)(api, module.PipelineTemplateDetailQuery(), CONTEXT, "missing")


@pytest.mark.parametrize(
    ("payload", "icon"),
    [
        ({"name": "Updated"}, {"icon": "", "icon_type": None, "icon_background": None, "icon_url": None}),
        (
            {"name": "Updated", "icon_info": {"icon": "book", "icon_type": "emoji", "icon_background": "#fff"}},
            {"icon": "book", "icon_type": "emoji", "icon_background": "#fff", "icon_url": None},
        ),
    ],
)
def test_patch_normalizes_icon_and_returns_empty_204(
    app: Flask,
    templates: MagicMock,
    payload: dict[str, object],
    icon: dict[str, object],
) -> None:
    api = module.CustomizedPipelineTemplateApi()
    with app.test_request_context("/"):
        result = unwrap(api.patch)(
            api, module.CustomizedPipelineTemplatePayload.model_validate(payload), CONTEXT, "template-1"
        )
    assert result == ("", 204)
    templates.update.assert_called_once_with(CONTEXT, "template-1", PipelineTemplateInput("Updated", "", icon))


@pytest.mark.parametrize("method", ["patch", "delete", "post"])
def test_missing_template_preserves_method_specific_error(
    app: Flask,
    templates: MagicMock,
    method: str,
) -> None:
    error = PipelineTemplateNotFoundError("Customized pipeline template not found.")
    api = module.CustomizedPipelineTemplateApi()
    if method == "patch":
        templates.update.side_effect = error
        args = (module.CustomizedPipelineTemplatePayload(name="Updated"), CONTEXT, "missing")
    elif method == "delete":
        templates.delete.side_effect = error
        args = (CONTEXT, "missing")
    else:
        templates.get_yaml.side_effect = error
        args = (CONTEXT, "missing")
    methods = {"patch": api.patch, "delete": api.delete, "post": api.post}
    with app.test_request_context("/"), pytest.raises(NotFound if method == "post" else ValueError):
        unwrap(methods[method])(api, *args)


def test_delete_and_yaml_export_contracts(app: Flask, templates: MagicMock) -> None:
    api = module.CustomizedPipelineTemplateApi()
    templates.get_yaml.return_value = "workflow: {}"
    with app.test_request_context("/"):
        assert unwrap(api.post)(api, CONTEXT, "template-1") == ({"data": "workflow: {}"}, 200)
        assert unwrap(api.delete)(api, CONTEXT, "template-1") == ("", 204)


@pytest.mark.parametrize("icon", [None, {}, {"icon": "book"}])
def test_publish_keeps_icon_payload_and_dataset_role(
    app: Flask,
    templates: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    icon: dict[str, str] | None,
) -> None:
    account = make_account(role=TenantAccountRole.DATASET_OPERATOR)
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (account, "tenant-1"))
    payload = {"name": "Template"} if icon is None else {"name": "Template", "icon_info": icon}
    parsed = module.CustomizedPipelineTemplatePayload.model_validate(payload)
    pipeline = _pipeline()
    api = module.PublishCustomizedPipelineTemplateApi()
    with app.test_request_context("/"):
        assert unwrap(api.post)(api, parsed, CONTEXT, pipeline) == ("", 204)
    templates.publish.assert_called_once_with(
        CONTEXT, "pipeline-1", PipelineTemplateInput("Template", "", parsed.icon_info), can_edit_datasets=True
    )


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (PipelineTemplateNotFoundError("Workflow not found"), NotFound),
        (PipelineTemplateNameConflictError(), ValueError),
        (PipelineTemplatePublishForbiddenError(), Forbidden),
        (DatasetAccessDeniedError(), Forbidden),
    ],
)
def test_publish_translates_application_errors(
    app: Flask,
    templates: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected: type[Exception],
) -> None:
    account = make_account(role=TenantAccountRole.OWNER)
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (account, "tenant-1"))
    templates.publish.side_effect = error
    api = module.PublishCustomizedPipelineTemplateApi()
    with app.test_request_context("/"), pytest.raises(expected):
        unwrap(api.post)(
            api,
            module.CustomizedPipelineTemplatePayload(name="Template"),
            CONTEXT,
            _pipeline(),
        )


def test_publish_retains_dataset_release_rbac() -> None:
    checks = rbac_checks(module.PublishCustomizedPipelineTemplateApi.post)
    assert len(checks) == 1
    assert checks[0].scene is module.RBACPermission.DATASET_PIPELINE_RELEASE
    assert isinstance(checks[0].locator, module.DatasetByPipeline)
