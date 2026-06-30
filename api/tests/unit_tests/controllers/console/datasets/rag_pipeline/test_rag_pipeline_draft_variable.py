import uuid
from inspect import unwrap
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.console import console_ns
from controllers.console.app.error import DraftWorkflowNotExist
from controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable import (
    RagPipelineEnvironmentVariableCollectionApi,
    RagPipelineNodeVariableCollectionApi,
    RagPipelineSystemVariableCollectionApi,
    RagPipelineVariableApi,
    RagPipelineVariableCollectionApi,
    RagPipelineVariableResetApi,
)
from core.workflow.variable_prefixes import SYSTEM_VARIABLE_NODE_ID
from factories.variable_factory import build_segment
from graphon.variables.types import SegmentType
from models.account import Account, TenantAccountRole
from models.workflow import WorkflowDraftVariable
from services.workflow_draft_variable_service import WorkflowDraftVariableList

_TEST_NODE_EXEC_ID = str(uuid.uuid4())


def _node_variable(*, app_id: str = "p1", value: Any = "hello") -> WorkflowDraftVariable:
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=app_id,
        user_id="account-1",
        node_id="node1",
        name="node_var",
        value=build_segment(value),
        node_execution_id=_TEST_NODE_EXEC_ID,
    )
    variable.id = str(uuid.uuid4())
    return variable


@pytest.fixture
def fake_db():
    db = MagicMock()
    db.engine = MagicMock()
    db.session.return_value = MagicMock()
    return db


@pytest.fixture
def editor_user() -> Account:
    user = Account(name="Test User", email="user@example.com")
    user.id = "account-1"
    user.role = TenantAccountRole.EDITOR
    return user


@pytest.fixture
def restx_config(app):
    return patch.dict(app.config, {"RESTX_MASK_HEADER": "X-Fields"})


class TestRagPipelineVariableCollectionApi:
    def test_get_variables_success(self, app: Flask, fake_db, editor_user, restx_config):
        api = RagPipelineVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = MagicMock(id="p1")
        variable = _node_variable(value="hello")

        rag_srv = MagicMock()
        rag_srv.is_workflow_exist.return_value = True

        var_list = WorkflowDraftVariableList(variables=[variable], total=1)

        draft_srv = MagicMock()
        draft_srv.list_variables_without_values.return_value = var_list

        with (
            app.test_request_context("/?page=1&limit=10"),
            restx_config,
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=draft_srv,
            ),
        ):
            result = method(api, editor_user, pipeline)

        assert result == {
            "items": [
                {
                    "id": variable.id,
                    "type": "node",
                    "name": "node_var",
                    "description": "",
                    "selector": ["node1", "node_var"],
                    "value_type": "string",
                    "edited": False,
                    "visible": True,
                    "is_truncated": False,
                }
            ],
            "total": 1,
        }
        draft_srv.list_variables_without_values.assert_called_once_with(
            app_id="p1",
            page=1,
            limit=10,
            user_id="account-1",
        )

    def test_get_variables_workflow_not_exist(self, app: Flask, fake_db, editor_user):
        api = RagPipelineVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = MagicMock()

        rag_srv = MagicMock()
        rag_srv.is_workflow_exist.return_value = False

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
        ):
            with pytest.raises(DraftWorkflowNotExist):
                method(api, editor_user, pipeline)

    def test_delete_variables_success(self, app: Flask, fake_db, editor_user):
        api = RagPipelineVariableCollectionApi()
        method = unwrap(api.delete)

        pipeline = MagicMock(id="p1")

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService"),
        ):
            result = method(api, editor_user, pipeline)

        assert result == ("", 204)


class TestRagPipelineNodeVariableCollectionApi:
    def test_get_node_variables_success(self, app: Flask, fake_db, editor_user, restx_config):
        api = RagPipelineNodeVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = MagicMock(id="p1")
        variable = _node_variable(value=None)
        var_list = WorkflowDraftVariableList(variables=[variable])

        srv = MagicMock()
        srv.list_node_variables.return_value = var_list

        with (
            app.test_request_context("/"),
            restx_config,
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, editor_user, pipeline, "node1")

        assert result == {
            "items": [
                {
                    "id": variable.id,
                    "type": "node",
                    "name": "node_var",
                    "description": "",
                    "selector": ["node1", "node_var"],
                    "value_type": "none",
                    "edited": False,
                    "visible": True,
                    "is_truncated": False,
                    "value": None,
                    "full_content": None,
                }
            ]
        }
        srv.list_node_variables.assert_called_once_with("p1", "node1", user_id="account-1")

    def test_get_node_variables_invalid_node(self, app: Flask, editor_user):
        api = RagPipelineNodeVariableCollectionApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
        ):
            with pytest.raises(InvalidArgumentError):
                method(api, editor_user, MagicMock(), SYSTEM_VARIABLE_NODE_ID)


class TestRagPipelineVariableApi:
    def test_get_variable_success_returns_concrete_shape(self, app: Flask, fake_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.get)

        pipeline = MagicMock(id="p1")
        variable = _node_variable(value={"answer": 42})

        srv = MagicMock()
        srv.get_variable.return_value = variable

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, editor_user, pipeline, variable.id)

        assert result == {
            "id": variable.id,
            "type": "node",
            "name": "node_var",
            "description": "",
            "selector": ["node1", "node_var"],
            "value_type": "object",
            "edited": False,
            "visible": True,
            "is_truncated": False,
            "value": {"answer": 42},
            "full_content": None,
        }

    def test_get_variable_not_found(self, app: Flask, fake_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.get)

        srv = MagicMock()
        srv.get_variable.return_value = None

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            with pytest.raises(NotFoundError):
                method(api, editor_user, MagicMock(), "v1")

    def test_patch_variable_invalid_file_payload(self, app: Flask, fake_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.patch)

        pipeline = MagicMock(id="p1", tenant_id="t1")
        variable = MagicMock(app_id="p1", value_type=SegmentType.FILE)

        srv = MagicMock()
        srv.get_variable.return_value = variable

        payload = {"value": "invalid"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            with pytest.raises(InvalidArgumentError):
                method(api, editor_user, pipeline, "v1")

    def test_patch_variable_noop_returns_current_concrete_shape(self, app: Flask, fake_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.patch)

        pipeline = MagicMock(id="p1", tenant_id="t1")
        variable = _node_variable(value=42)

        srv = MagicMock()
        srv.get_variable.return_value = variable

        with (
            app.test_request_context("/", json={}),
            patch.object(type(console_ns), "payload", {}),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, editor_user, pipeline, variable.id)

        assert result == {
            "id": variable.id,
            "type": "node",
            "name": "node_var",
            "description": "",
            "selector": ["node1", "node_var"],
            "value_type": "number",
            "edited": False,
            "visible": True,
            "is_truncated": False,
            "value": 42,
            "full_content": None,
        }
        srv.update_variable.assert_not_called()

    def test_delete_variable_success(self, app: Flask, fake_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.delete)

        pipeline = MagicMock(id="p1")
        variable = MagicMock(app_id="p1")

        srv = MagicMock()
        srv.get_variable.return_value = variable

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, editor_user, pipeline, "v1")

        assert result == ("", 204)


class TestRagPipelineVariableResetApi:
    def test_reset_variable_success(self, app: Flask, fake_db, editor_user):
        api = RagPipelineVariableResetApi()
        method = unwrap(api.put)

        pipeline = MagicMock(id="p1")
        workflow = MagicMock()
        variable = _node_variable(value="reset")

        srv = MagicMock()
        srv.get_variable.return_value = variable
        srv.reset_variable.return_value = variable

        rag_srv = MagicMock()
        rag_srv.get_draft_workflow.return_value = workflow

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, editor_user, pipeline, variable.id)

        assert result == {
            "id": variable.id,
            "type": "node",
            "name": "node_var",
            "description": "",
            "selector": ["node1", "node_var"],
            "value_type": "string",
            "edited": False,
            "visible": True,
            "is_truncated": False,
            "value": "reset",
            "full_content": None,
        }


class TestSystemAndEnvironmentVariablesApi:
    def test_system_variables_success(self, app: Flask, fake_db, editor_user, restx_config):
        api = RagPipelineSystemVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = MagicMock(id="p1")
        variable = WorkflowDraftVariable.new_sys_variable(
            app_id="p1",
            user_id="account-1",
            name="query",
            value=build_segment("system query"),
            editable=True,
            node_execution_id=_TEST_NODE_EXEC_ID,
        )
        variable.id = str(uuid.uuid4())
        var_list = WorkflowDraftVariableList(variables=[variable])

        srv = MagicMock()
        srv.list_system_variables.return_value = var_list

        with (
            app.test_request_context("/"),
            restx_config,
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, editor_user, pipeline)

        assert result == {
            "items": [
                {
                    "id": variable.id,
                    "type": "sys",
                    "name": "query",
                    "description": "",
                    "selector": ["sys", "query"],
                    "value_type": "string",
                    "edited": False,
                    "visible": True,
                    "is_truncated": False,
                    "value": "system query",
                    "full_content": None,
                }
            ]
        }
        srv.list_system_variables.assert_called_once_with("p1", user_id="account-1")

    def test_environment_variables_success(self, app: Flask, editor_user):
        api = RagPipelineEnvironmentVariableCollectionApi()
        method = unwrap(api.get)

        env_var = SimpleNamespace(
            id="e1",
            name="ENV",
            description="d",
            selector=["env", "ENV"],
            value_type=SimpleNamespace(value="string"),
            value="x",
        )

        workflow = MagicMock(environment_variables=[env_var])
        pipeline = MagicMock(id="p1")

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

        assert result == {
            "items": [
                {
                    "id": "e1",
                    "type": "env",
                    "name": "ENV",
                    "description": "d",
                    "selector": ["env", "ENV"],
                    "value_type": "string",
                    "value": "x",
                    "edited": False,
                    "visible": True,
                    "editable": True,
                }
            ]
        }
