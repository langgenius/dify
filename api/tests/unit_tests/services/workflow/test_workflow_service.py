from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.workflow.enums import NodeType
from core.workflow.nodes.human_input.entities import FormInput, HumanInputNodeData, UserAction
from core.workflow.nodes.human_input.enums import FormInputType
from models.model import App
from models.workflow import Workflow
from services import workflow_service as workflow_service_module
from services.workflow_service import WorkflowService


class TestWorkflowService:
    @pytest.fixture
    def workflow_service(self):
        mock_session_maker = MagicMock()
        return WorkflowService(mock_session_maker)

    @pytest.fixture
    def mock_app(self):
        app = MagicMock(spec=App)
        app.id = "app-id-1"
        app.workflow_id = "workflow-id-1"
        app.tenant_id = "tenant-id-1"
        return app

    @pytest.fixture
    def mock_workflows(self):
        workflows = []
        for i in range(5):
            workflow = MagicMock(spec=Workflow)
            workflow.id = f"workflow-id-{i}"
            workflow.app_id = "app-id-1"
            workflow.created_at = f"2023-01-0{5 - i}"  # Descending date order
            workflow.created_by = "user-id-1" if i % 2 == 0 else "user-id-2"
            workflow.marked_name = f"Workflow {i}" if i % 2 == 0 else ""
            workflows.append(workflow)
        return workflows

    def test_get_all_published_workflow_no_workflow_id(self, workflow_service, mock_app):
        mock_app.workflow_id = None
        mock_session = MagicMock()

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=10, user_id=None
        )

        assert workflows == []
        assert has_more is False
        mock_session.scalars.assert_not_called()

    def test_get_all_published_workflow_basic(self, workflow_service, mock_app, mock_workflows):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        mock_scalar_result.all.return_value = mock_workflows[:3]
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=3, user_id=None
        )

        assert workflows == mock_workflows[:3]
        assert has_more is False
        mock_session.scalars.assert_called_once()

    def test_get_all_published_workflow_pagination(self, workflow_service, mock_app, mock_workflows):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        # Return 4 items when limit is 3, which should indicate has_more=True
        mock_scalar_result.all.return_value = mock_workflows[:4]
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=3, user_id=None
        )

        # Should return only the first 3 items
        assert len(workflows) == 3
        assert workflows == mock_workflows[:3]
        assert has_more is True

        # Test page 2
        mock_scalar_result.all.return_value = mock_workflows[3:]
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=2, limit=3, user_id=None
        )

        assert len(workflows) == 2
        assert has_more is False

    def test_get_all_published_workflow_user_filter(self, workflow_service, mock_app, mock_workflows):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        # Filter workflows for user-id-1
        filtered_workflows = [w for w in mock_workflows if w.created_by == "user-id-1"]
        mock_scalar_result.all.return_value = filtered_workflows
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=10, user_id="user-id-1"
        )

        assert workflows == filtered_workflows
        assert has_more is False
        mock_session.scalars.assert_called_once()

        # Verify that the select contains a user filter clause
        args = mock_session.scalars.call_args[0][0]
        assert "created_by" in str(args)

    def test_get_all_published_workflow_named_only(self, workflow_service, mock_app, mock_workflows):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        # Filter workflows that have a marked_name
        named_workflows = [w for w in mock_workflows if w.marked_name]
        mock_scalar_result.all.return_value = named_workflows
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=10, user_id=None, named_only=True
        )

        assert workflows == named_workflows
        assert has_more is False
        mock_session.scalars.assert_called_once()

        # Verify that the select contains a named_only filter clause
        args = mock_session.scalars.call_args[0][0]
        assert "marked_name !=" in str(args)

    def test_get_all_published_workflow_combined_filters(self, workflow_service, mock_app, mock_workflows):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        # Combined filter: user-id-1 and has marked_name
        filtered_workflows = [w for w in mock_workflows if w.created_by == "user-id-1" and w.marked_name]
        mock_scalar_result.all.return_value = filtered_workflows
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=10, user_id="user-id-1", named_only=True
        )

        assert workflows == filtered_workflows
        assert has_more is False
        mock_session.scalars.assert_called_once()

        # Verify that both filters are applied
        args = mock_session.scalars.call_args[0][0]
        assert "created_by" in str(args)
        assert "marked_name !=" in str(args)

    def test_get_all_published_workflow_empty_result(self, workflow_service, mock_app):
        mock_session = MagicMock()
        mock_scalar_result = MagicMock()
        mock_scalar_result.all.return_value = []
        mock_session.scalars.return_value = mock_scalar_result

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=mock_app, page=1, limit=10, user_id=None
        )

        assert workflows == []
        assert has_more is False
        mock_session.scalars.assert_called_once()

    def test_submit_human_input_form_preview_uses_rendered_content(
        self, workflow_service: WorkflowService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        service = workflow_service
        node_data = HumanInputNodeData(
            title="Human Input",
            form_content="<p>{{#$output.name#}}</p>",
            inputs=[FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="name")],
            user_actions=[UserAction(id="approve", title="Approve")],
        )
        node = MagicMock()
        node.node_data = node_data
        node.render_form_content_before_submission.return_value = "<p>preview</p>"
        node.render_form_content_with_outputs.return_value = "<p>rendered</p>"

        service._build_human_input_variable_pool = MagicMock(return_value=MagicMock())  # type: ignore[method-assign]
        service._build_human_input_node = MagicMock(return_value=node)  # type: ignore[method-assign]

        workflow = MagicMock()
        workflow.get_node_config_by_id.return_value = {"id": "node-1", "data": {"type": NodeType.HUMAN_INPUT.value}}
        workflow.get_enclosing_node_type_and_id.return_value = None
        service.get_draft_workflow = MagicMock(return_value=workflow)  # type: ignore[method-assign]

        saved_outputs: dict[str, object] = {}

        class DummySession:
            def __init__(self, *args, **kwargs):
                self.commit = MagicMock()

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def begin(self):
                return nullcontext()

        class DummySaver:
            def __init__(self, *args, **kwargs):
                pass

            def save(self, outputs, process_data):
                saved_outputs.update(outputs)

        monkeypatch.setattr(workflow_service_module, "Session", DummySession)
        monkeypatch.setattr(workflow_service_module, "DraftVariableSaver", DummySaver)
        monkeypatch.setattr(workflow_service_module, "db", SimpleNamespace(engine=MagicMock()))

        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        account = SimpleNamespace(id="account-1")

        result = service.submit_human_input_form_preview(
            app_model=app_model,
            account=account,
            node_id="node-1",
            form_inputs={"name": "Ada", "extra": "ignored"},
            inputs={"#node-0.result#": "LLM output"},
            action="approve",
        )

        service._build_human_input_variable_pool.assert_called_once_with(
            app_model=app_model,
            workflow=workflow,
            node_config={"id": "node-1", "data": {"type": NodeType.HUMAN_INPUT.value}},
            manual_inputs={"#node-0.result#": "LLM output"},
        )

        node.render_form_content_with_outputs.assert_called_once()
        called_args = node.render_form_content_with_outputs.call_args.args
        assert called_args[0] == "<p>preview</p>"
        assert called_args[2] == node_data.outputs_field_names()
        rendered_outputs = called_args[1]
        assert rendered_outputs["name"] == "Ada"
        assert rendered_outputs["extra"] == "ignored"
        assert "extra" in saved_outputs
        assert "extra" in result
        assert saved_outputs["name"] == "Ada"
        assert result["name"] == "Ada"
        assert result["__action_id"] == "approve"
        assert "__rendered_content" in result

    def test_submit_human_input_form_preview_missing_inputs_message(self, workflow_service: WorkflowService) -> None:
        service = workflow_service
        node_data = HumanInputNodeData(
            title="Human Input",
            form_content="<p>{{#$output.name#}}</p>",
            inputs=[FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="name")],
            user_actions=[UserAction(id="approve", title="Approve")],
        )
        node = MagicMock()
        node.node_data = node_data
        node._render_form_content_before_submission.return_value = "<p>preview</p>"
        node._render_form_content_with_outputs.return_value = "<p>rendered</p>"

        service._build_human_input_variable_pool = MagicMock(return_value=MagicMock())  # type: ignore[method-assign]
        service._build_human_input_node = MagicMock(return_value=node)  # type: ignore[method-assign]

        workflow = MagicMock()
        workflow.get_node_config_by_id.return_value = {"id": "node-1", "data": {"type": NodeType.HUMAN_INPUT.value}}
        service.get_draft_workflow = MagicMock(return_value=workflow)  # type: ignore[method-assign]

        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        account = SimpleNamespace(id="account-1")

        with pytest.raises(ValueError) as exc_info:
            service.submit_human_input_form_preview(
                app_model=app_model,
                account=account,
                node_id="node-1",
                form_inputs={},
                inputs={},
                action="approve",
            )

        assert "Missing required inputs" in str(exc_info.value)
