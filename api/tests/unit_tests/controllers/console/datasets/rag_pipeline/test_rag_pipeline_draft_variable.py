from collections.abc import Callable, Iterator
from inspect import getclosurevars, unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, Response
from sqlalchemy import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.console import console_ns
from controllers.console.app.error import DraftWorkflowNotExist
from controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable import (
    PaginationQuery,
    RagPipelineEnvironmentVariableCollectionApi,
    RagPipelineNodeVariableCollectionApi,
    RagPipelineSystemVariableCollectionApi,
    RagPipelineVariableApi,
    RagPipelineVariableCollectionApi,
    RagPipelineVariableResetApi,
    WorkflowDraftVariablePatchPayload,
)
from controllers.console.wraps import RBACPermission, RBACResourceScope
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from core.workflow.variable_prefixes import SYSTEM_VARIABLE_NODE_ID
from factories.variable_factory import build_segment
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables import IntegerVariable, StringVariable
from models.account import Account, TenantAccountRole
from models.dataset import Pipeline
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowType


@pytest.fixture
def sqlite_db(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[SimpleNamespace]:
    session = scoped_session(sqlite_session_factory)
    yield SimpleNamespace(engine=sqlite_engine, session=session)
    session.remove()


def _pipeline(*, pipeline_id: str = "p1", tenant_id: str = "t1") -> Pipeline:
    pipeline = Pipeline(tenant_id=tenant_id, name="Pipeline")
    pipeline.id = pipeline_id
    return pipeline


def _workflow(pipeline: Pipeline, environment_variables=()) -> Workflow:
    return Workflow.new(
        tenant_id=pipeline.tenant_id,
        app_id=pipeline.id,
        type=WorkflowType.RAG_PIPELINE,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features="{}",
        created_by="account-1",
        environment_variables=environment_variables,
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _variable(*, app_id: str = "p1", user_id: str = "account-1", file_value: bool = False) -> WorkflowDraftVariable:
    if file_value:
        value = build_segment(
            File(
                file_id="file-1",
                file_type=FileType.IMAGE,
                transfer_method=FileTransferMethod.REMOTE_URL,
                remote_url="https://example.com/image.png",
                filename="image.png",
                extension=".png",
                mime_type="image/png",
                size=1,
            )
        )
    else:
        value = build_segment("value")
    return WorkflowDraftVariable.new_node_variable(
        app_id=app_id,
        user_id=user_id,
        node_id="node-1",
        name="variable",
        value=value,
        node_execution_id="execution-1",
    )


@pytest.fixture
def editor_user() -> Account:
    user = Account(name="Test User", email="user@example.com")
    user.id = "account-1"
    user.role = TenantAccountRole.EDITOR
    return user


@pytest.fixture
def restx_config(app):
    return patch.dict(app.config, {"RESTX_MASK_HEADER": "X-Fields"})


def test_rag_draft_variable_routes_require_dataset_edit_permission() -> None:
    route = RagPipelineVariableApi.get
    legacy_gate = unwrap(route, stop=lambda decorator: "edit_permission_required" in decorator.__code__.co_qualname)
    rbac_gate = unwrap(route, stop=lambda decorator: "scene" in getclosurevars(decorator).nonlocals)

    assert "edit_permission_required" in legacy_gate.__code__.co_qualname
    permissions = getclosurevars(rbac_gate).nonlocals
    assert permissions["resource_type"] == RBACResourceScope.DATASET
    assert permissions["scene"] == RBACPermission.DATASET_EDIT


class TestRagPipelineVariableCollectionApi:
    def test_get_variables_success(self, app: Flask, sqlite_db, editor_user, restx_config):
        api = RagPipelineVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = _pipeline()

        rag_srv = MagicMock()
        rag_srv.is_workflow_exist.return_value = True

        # IMPORTANT: RESTX expects .variables
        var_list = MagicMock()
        var_list.variables = []

        draft_srv = MagicMock()
        draft_srv.list_variables_without_values.return_value = var_list

        with (
            app.test_request_context("/?page=1&limit=10"),
            restx_config,
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", sqlite_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=draft_srv,
            ),
        ):
            result = method(api, PaginationQuery(page=1, limit=10), editor_user, pipeline)

        assert result is var_list
        draft_srv.list_variables_without_values.assert_called_once_with(
            app_id="p1",
            page=1,
            limit=10,
            user_id="account-1",
        )

    def test_get_variables_workflow_not_exist(self, app: Flask, sqlite_db, editor_user):
        api = RagPipelineVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = _pipeline()

        rag_srv = MagicMock()
        rag_srv.is_workflow_exist.return_value = False

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", sqlite_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
        ):
            with pytest.raises(DraftWorkflowNotExist):
                method(api, PaginationQuery(), editor_user, pipeline)

    def test_delete_variables_success(self, app: Flask, sqlite_db, editor_user):
        api = RagPipelineVariableCollectionApi()
        method = unwrap(api.delete)

        pipeline = _pipeline()

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", sqlite_db),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService"),
        ):
            result = method(api, editor_user, pipeline)

        assert isinstance(result, Response)
        assert result.status_code == 204


class TestRagPipelineNodeVariableCollectionApi:
    def test_get_node_variables_success(self, app: Flask, sqlite_db, editor_user, restx_config):
        api = RagPipelineNodeVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = _pipeline()

        var_list = MagicMock()
        var_list.variables = []

        srv = MagicMock()
        srv.list_node_variables.return_value = var_list

        with (
            app.test_request_context("/"),
            restx_config,
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", sqlite_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, editor_user, pipeline, "node1")

        assert result is var_list
        srv.list_node_variables.assert_called_once_with("p1", "node1", user_id="account-1")

    def test_get_node_variables_invalid_node(self, app: Flask, editor_user):
        api = RagPipelineNodeVariableCollectionApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
        ):
            with pytest.raises(InvalidArgumentError):
                method(api, editor_user, _pipeline(), SYSTEM_VARIABLE_NODE_ID)


class TestRagPipelineVariableApi:
    def test_get_variable_not_found(self, app: Flask, sqlite_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.get)

        srv = MagicMock()
        srv.get_variable.return_value = None

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", sqlite_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            with pytest.raises(NotFoundError):
                method(api, editor_user, _pipeline(), "v1")

    def test_patch_variable_invalid_file_payload(self, app: Flask, sqlite_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.patch)

        pipeline = _pipeline()
        variable = _variable(file_value=True)

        srv = MagicMock()
        srv.get_variable.return_value = variable

        payload = {"value": "invalid"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", sqlite_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            with pytest.raises(InvalidArgumentError):
                method(api, WorkflowDraftVariablePatchPayload.model_validate(payload), editor_user, pipeline, "v1")

    def test_delete_variable_success(self, app: Flask, sqlite_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.delete)

        pipeline = _pipeline()
        variable = _variable()

        srv = MagicMock()
        srv.get_variable.return_value = variable

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", sqlite_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, editor_user, pipeline, "v1")

        assert result.status_code == 204


@pytest.mark.parametrize(
    ("api_type", "method", "payload"),
    [
        (RagPipelineVariableApi, RagPipelineVariableApi.get, None),
        (
            RagPipelineVariableApi,
            RagPipelineVariableApi.patch,
            WorkflowDraftVariablePatchPayload(name="new name"),
        ),
        (RagPipelineVariableApi, RagPipelineVariableApi.delete, None),
        (RagPipelineVariableResetApi, RagPipelineVariableResetApi.put, None),
    ],
)
def test_direct_variable_access_rejects_different_user(
    app: Flask,
    sqlite_db: SimpleNamespace,
    editor_user: Account,
    api_type: type[RagPipelineVariableApi] | type[RagPipelineVariableResetApi],
    method: Callable[..., object],
    payload: WorkflowDraftVariablePatchPayload | None,
) -> None:
    api = api_type()
    method = unwrap(method)
    pipeline = _pipeline()
    variable = _variable(user_id="account-2")
    draft_service = MagicMock()
    draft_service.get_variable.return_value = variable
    rag_service = MagicMock()
    rag_service.get_draft_workflow.return_value = _workflow(pipeline)
    if payload is not None:
        call_args = (api, payload, editor_user, pipeline, "v1")
    else:
        call_args = (api, editor_user, pipeline, "v1")

    with (
        app.test_request_context("/"),
        patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", sqlite_db),
        patch.object(sqlite_db.session, "commit") as commit,
        patch(
            "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
            return_value=rag_service,
        ),
        patch(
            "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
            return_value=draft_service,
        ),
        pytest.raises(NotFoundError),
    ):
        method(*call_args)

    draft_service.update_variable.assert_not_called()
    draft_service.delete_variable.assert_not_called()
    draft_service.reset_variable.assert_not_called()
    commit.assert_not_called()


class TestRagPipelineVariableResetApi:
    def test_reset_variable_success(self, app: Flask, sqlite_db, editor_user):
        api = RagPipelineVariableResetApi()
        method = unwrap(api.put)

        pipeline = _pipeline()
        workflow = _workflow(pipeline)
        variable = _variable()

        srv = MagicMock()
        srv.get_variable.return_value = variable
        srv.reset_variable.return_value = variable

        rag_srv = MagicMock()
        rag_srv.get_draft_workflow.return_value = workflow

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", sqlite_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.marshal",
                return_value={"id": "v1"},
            ),
        ):
            result = method(api, editor_user, pipeline, "v1")

        assert result == {"id": "v1"}


class TestSystemAndEnvironmentVariablesApi:
    def test_system_variables_success(self, app: Flask, sqlite_db, editor_user, restx_config):
        api = RagPipelineSystemVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = _pipeline()

        var_list = MagicMock()
        var_list.variables = []

        srv = MagicMock()
        srv.list_system_variables.return_value = var_list

        with (
            app.test_request_context("/"),
            restx_config,
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", sqlite_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, editor_user, pipeline)

        assert result is var_list
        srv.list_system_variables.assert_called_once_with("p1", user_id="account-1")

    def test_environment_variables_success(self, app: Flask, editor_user):
        api = RagPipelineEnvironmentVariableCollectionApi()
        method = unwrap(api.get)

        env_var = StringVariable(
            id="e1",
            name="ENV",
            description="d",
            selector=["env", "ENV"],
            value="x",
        )

        pipeline = _pipeline()
        workflow = _workflow(pipeline, [env_var])

        rag_srv = MagicMock()
        rag_srv.get_draft_workflow.return_value = workflow

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
        ):
            result = method(api, editor_user, pipeline)

        assert len(result["items"]) == 1
        assert result["items"][0]["value_type"] == "string"

    def test_environment_variables_preserve_number_subtype_and_llm_type(self, app: Flask, editor_user):
        api = RagPipelineEnvironmentVariableCollectionApi()
        method = unwrap(api.get)
        number_var = IntegerVariable(
            id="number",
            name="NUMBER",
            description="",
            selector=["env", "NUMBER"],
            value=1,
        )
        llm_var = LLMEnvironmentVariable(
            id="llm",
            name="MODEL",
            value={"provider": "provider", "name": "model", "mode": "chat"},
            selector=["env", "MODEL"],
        )
        pipeline = _pipeline()
        rag_srv = MagicMock()
        rag_srv.get_draft_workflow.return_value = _workflow(pipeline, [number_var, llm_var])

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
        ):
            result = method(api, editor_user, pipeline)

        assert [item["value_type"] for item in result["items"]] == ["integer", "llm"]
