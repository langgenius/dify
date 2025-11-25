"""
Tests for WorkflowAppRunnerHandler.

Test objectives:
1. Verify handler compatibility with real WorkflowAppRunner structure (fails when structure changes)
2. Verify span attribute mapping correctness
"""

from unittest.mock import patch

from extensions.otel.decorators.handlers.workflow_app_runner_handler import WorkflowAppRunnerHandler
from extensions.otel.semconv import DifySpanAttributes, GenAIAttributes


class TestWorkflowAppRunnerHandler:
    """Core tests for WorkflowAppRunnerHandler"""

    def test_handler_structure_dependencies(self):
        """
        Verify handler dependencies on WorkflowAppRunner structure.

        Handler depends on:
        - runner.application_generate_entity (WorkflowAppGenerateEntity)
        - entity.app_config (WorkflowAppConfig)
        - entity.user_id, entity.stream
        - app_config.app_id, app_config.tenant_id, app_config.workflow_id

        If these attribute paths change in real types, this test will fail,
        prompting developers to update the handler's attribute access logic.
        """
        from core.app.app_config.entities import WorkflowUIBasedAppConfig
        from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity

        required_entity_fields = ["user_id", "stream", "app_config"]
        entity_fields = WorkflowAppGenerateEntity.model_fields
        for field in required_entity_fields:
            assert field in entity_fields, f"Handler expects WorkflowAppGenerateEntity.{field} but field is missing"

        required_config_fields = ["app_id", "tenant_id", "workflow_id"]
        config_fields = WorkflowUIBasedAppConfig.model_fields
        for field in required_config_fields:
            assert field in config_fields, f"Handler expects app_config.{field} but field is missing"

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_all_span_attributes_set_correctly(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_workflow_runner
    ):
        """Verify all span attributes are mapped correctly"""
        handler = WorkflowAppRunnerHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        test_app_id = "app-999"
        test_tenant_id = "tenant-888"
        test_user_id = "user-777"
        test_workflow_id = "wf-666"

        mock_workflow_runner.application_generate_entity.user_id = test_user_id
        mock_workflow_runner.application_generate_entity.stream = False
        mock_workflow_runner.application_generate_entity.app_config.app_id = test_app_id
        mock_workflow_runner.application_generate_entity.app_config.tenant_id = test_tenant_id
        mock_workflow_runner.application_generate_entity.app_config.workflow_id = test_workflow_id

        def runner_run(self):
            return "result"

        handler.wrapper(tracer, runner_run, (mock_workflow_runner,), {})

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = spans[0].attributes

        assert attrs[DifySpanAttributes.APP_ID] == test_app_id
        assert attrs[DifySpanAttributes.TENANT_ID] == test_tenant_id
        assert attrs[GenAIAttributes.USER_ID] == test_user_id
        assert attrs[DifySpanAttributes.WORKFLOW_ID] == test_workflow_id
        assert attrs[DifySpanAttributes.STREAMING] is False
