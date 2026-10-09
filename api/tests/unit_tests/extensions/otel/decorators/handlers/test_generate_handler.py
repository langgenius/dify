"""
Tests for AppGenerateHandler.

Test objectives:
1. Verify handler compatibility with real function signature (fails when parameters change)
2. Verify span attribute mapping correctness
"""

from unittest.mock import MagicMock, create_autospec

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.otel.decorators.handlers.generate_handler import AppGenerateHandler
from extensions.otel.semconv import DifySpanAttributes, GenAIAttributes
from models import Account, App
from services.app.generation.runtime import AppGenerationRuntime
from services.workflow.variable_contracts import WorkflowExecutionVariables
from tests.unit_tests.config_override import config_overrides_context


class TestAppGenerateHandler:
    """Core tests for AppGenerateHandler"""

    @config_overrides_context(ENABLE_OTEL=True)
    def test_compatible_with_real_function_signature(
        self,
        tracer_provider_with_memory_exporter: TracerProvider,
        mock_app_model: App,
        mock_account_user: Account,
    ) -> None:
        """
        Verify handler compatibility with real AppGenerateService.generate signature.

        If AppGenerateService.generate parameters change, this test will fail,
        prompting developers to update the handler's parameter extraction logic.
        """
        from services.app_generate_service import AppGenerateService

        handler = AppGenerateHandler()

        arguments = handler._extract_arguments(
            AppGenerateService.generate,
            session=MagicMock(),
            app_model=mock_app_model,
            user=mock_account_user,
            args={"workflow_id": "test-wf-123"},
            invoke_from=InvokeFrom.DEBUGGER,
            variables=create_autospec(WorkflowExecutionVariables, instance=True, spec_set=True),
            runtime=create_autospec(AppGenerationRuntime, instance=True, spec_set=True),
            streaming=True,
            root_node_id=None,
        )

        assert arguments is not None, "Failed to extract arguments from AppGenerateService.generate"
        assert "app_model" in arguments, "Handler uses app_model but parameter is missing"
        assert "user" in arguments, "Handler uses user but parameter is missing"
        assert "args" in arguments, "Handler uses args but parameter is missing"
        assert "streaming" in arguments, "Handler uses streaming but parameter is missing"

    @config_overrides_context(ENABLE_OTEL=True)
    def test_all_span_attributes_set_correctly(
        self,
        tracer_provider_with_memory_exporter: TracerProvider,
        memory_span_exporter: InMemorySpanExporter,
        mock_app_model: App,
        mock_account_user: Account,
    ) -> None:
        """Verify all span attributes are mapped correctly"""
        handler = AppGenerateHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        test_app_id = "app-456"
        test_tenant_id = "tenant-789"
        test_user_id = "user-111"
        test_workflow_id = "wf-222"

        mock_app_model.id = test_app_id
        mock_app_model.tenant_id = test_tenant_id
        mock_account_user.id = test_user_id

        def dummy_func(
            app_model: App,
            user: Account,
            args: dict[str, object],
            invoke_from: InvokeFrom,
            streaming: bool = True,
        ) -> str:
            del app_model, user, args, invoke_from, streaming
            return "result"

        handler.wrapper(
            tracer,
            dummy_func,
            app_model=mock_app_model,
            user=mock_account_user,
            args={"workflow_id": test_workflow_id},
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=False,
        )

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = spans[0].attributes
        assert attrs is not None

        assert attrs[DifySpanAttributes.APP_ID] == test_app_id
        assert attrs[DifySpanAttributes.TENANT_ID] == test_tenant_id
        assert attrs[GenAIAttributes.USER_ID] == test_user_id
        assert attrs[DifySpanAttributes.WORKFLOW_ID] == test_workflow_id
        assert attrs[DifySpanAttributes.USER_TYPE] == "Account"
        assert attrs[DifySpanAttributes.STREAMING] is False
