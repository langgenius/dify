"""
Service for generating snippet workflow executions.

Uses an adapter pattern to bridge CustomizedSnippet with the App-based
WorkflowAppGenerator. The adapter (_SnippetAsApp) provides the minimal App-like
interface needed by the generator, avoiding modifications to core workflow
infrastructure.

Key invariants:
- Snippets always run as WORKFLOW mode (not CHAT or ADVANCED_CHAT).
- The adapter maps snippet.id to app_id in workflow execution records.
- Snippet debugging has no rate limiting (max_active_requests = 0).

Supported execution modes:
- Full workflow run (generate): Runs the entire draft workflow as SSE stream.
- Single node run (run_draft_node): Synchronous single-step debugging for regular nodes.
- Single iteration run (generate_single_iteration): SSE stream for iteration container nodes.
- Single loop run (generate_single_loop): SSE stream for loop container nodes.
"""

import logging
from collections.abc import Generator, Mapping, Sequence
from typing import Any, Union

from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.file.models import File
from factories import file_factory
from models import Account
from models.model import AppMode, EndUser
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowNodeExecutionModel
from services.snippet_service import SnippetService
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)


class _SnippetAsApp:
    """
    Minimal adapter that wraps a CustomizedSnippet to satisfy the App-like
    interface required by WorkflowAppGenerator, WorkflowAppConfigManager,
    and WorkflowService.run_draft_workflow_node.

    Used properties:
    - id: maps to snippet.id (stored as app_id in workflows table)
    - tenant_id: maps to snippet.tenant_id
    - mode: hardcoded to AppMode.WORKFLOW since snippets always run as workflows
    - max_active_requests: defaults to 0 (no limit) for snippet debugging
    - app_model_config_id: None (snippets don't have app model configs)
    """

    id: str
    tenant_id: str
    mode: str
    max_active_requests: int
    app_model_config_id: str | None

    def __init__(self, snippet: CustomizedSnippet) -> None:
        self.id = snippet.id
        self.tenant_id = snippet.tenant_id
        self.mode = AppMode.WORKFLOW.value
        self.max_active_requests = 0
        self.app_model_config_id = None


class SnippetGenerateService:
    """
    Service for running snippet workflow executions.

    Adapts CustomizedSnippet to work with the existing App-based
    WorkflowAppGenerator infrastructure, avoiding duplication of the
    complex workflow execution pipeline.
    """

    @classmethod
    def generate(
        cls,
        snippet: CustomizedSnippet,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
    ) -> Union[Mapping[str, Any], Generator[Mapping[str, Any] | str, None, None]]:
        """
        Run a snippet's draft workflow.

        Retrieves the draft workflow, adapts the snippet to an App-like proxy,
        then delegates execution to WorkflowAppGenerator.

        :param snippet: CustomizedSnippet instance
        :param user: Account or EndUser initiating the run
        :param args: Workflow inputs (must include "inputs" key)
        :param invoke_from: Source of invocation (typically DEBUGGER)
        :param streaming: Whether to stream the response
        :return: Blocking response mapping or SSE streaming generator
        :raises ValueError: If the snippet has no draft workflow
        """
        snippet_service = SnippetService()
        workflow = snippet_service.get_draft_workflow(snippet=snippet)
        if not workflow:
            raise ValueError("Workflow not initialized")

        # Adapt snippet to App-like interface for WorkflowAppGenerator
        app_proxy = _SnippetAsApp(snippet)

        return WorkflowAppGenerator.convert_to_event_stream(
            WorkflowAppGenerator().generate(
                app_model=app_proxy,  # type: ignore[arg-type]
                workflow=workflow,
                user=user,
                args=args,
                invoke_from=invoke_from,
                streaming=streaming,
                call_depth=0,
            )
        )

    @classmethod
    def run_draft_node(
        cls,
        snippet: CustomizedSnippet,
        node_id: str,
        user_inputs: Mapping[str, Any],
        account: Account,
        query: str = "",
        files: Sequence[File] | None = None,
    ) -> WorkflowNodeExecutionModel:
        """
        Run a single node in a snippet's draft workflow (single-step debugging).

        Retrieves the draft workflow, adapts the snippet to an App-like proxy,
        parses file inputs, then delegates to WorkflowService.run_draft_workflow_node.

        :param snippet: CustomizedSnippet instance
        :param node_id: ID of the node to run
        :param user_inputs: User input values for the node
        :param account: Account initiating the run
        :param query: Optional query string
        :param files: Optional parsed file objects
        :return: WorkflowNodeExecutionModel with execution results
        :raises ValueError: If the snippet has no draft workflow
        """
        snippet_service = SnippetService()
        draft_workflow = snippet_service.get_draft_workflow(snippet=snippet)
        if not draft_workflow:
            raise ValueError("Workflow not initialized")

        app_proxy = _SnippetAsApp(snippet)

        workflow_service = WorkflowService()
        return workflow_service.run_draft_workflow_node(
            app_model=app_proxy,  # type: ignore[arg-type]
            draft_workflow=draft_workflow,
            node_id=node_id,
            user_inputs=user_inputs,
            account=account,
            query=query,
            files=files,
        )

    @classmethod
    def generate_single_iteration(
        cls,
        snippet: CustomizedSnippet,
        user: Union[Account, EndUser],
        node_id: str,
        args: Mapping[str, Any],
        streaming: bool = True,
    ) -> Union[Mapping[str, Any], Generator[Mapping[str, Any] | str, None, None]]:
        """
        Run a single iteration node in a snippet's draft workflow.

        Iteration nodes are container nodes that execute their sub-graph multiple
        times, producing many events. Therefore, this uses the full WorkflowAppGenerator
        pipeline with SSE streaming (unlike regular single-step node run).

        :param snippet: CustomizedSnippet instance
        :param user: Account or EndUser initiating the run
        :param node_id: ID of the iteration node to run
        :param args: Dict containing 'inputs' key with iteration input data
        :param streaming: Whether to stream the response (should be True)
        :return: SSE streaming generator
        :raises ValueError: If the snippet has no draft workflow
        """
        snippet_service = SnippetService()
        workflow = snippet_service.get_draft_workflow(snippet=snippet)
        if not workflow:
            raise ValueError("Workflow not initialized")

        app_proxy = _SnippetAsApp(snippet)

        return WorkflowAppGenerator.convert_to_event_stream(
            WorkflowAppGenerator().single_iteration_generate(
                app_model=app_proxy,  # type: ignore[arg-type]
                workflow=workflow,
                node_id=node_id,
                user=user,
                args=args,
                streaming=streaming,
            )
        )

    @classmethod
    def generate_single_loop(
        cls,
        snippet: CustomizedSnippet,
        user: Union[Account, EndUser],
        node_id: str,
        args: Any,
        streaming: bool = True,
    ) -> Union[Mapping[str, Any], Generator[Mapping[str, Any] | str, None, None]]:
        """
        Run a single loop node in a snippet's draft workflow.

        Loop nodes are container nodes that execute their sub-graph repeatedly,
        producing many events. Therefore, this uses the full WorkflowAppGenerator
        pipeline with SSE streaming (unlike regular single-step node run).

        :param snippet: CustomizedSnippet instance
        :param user: Account or EndUser initiating the run
        :param node_id: ID of the loop node to run
        :param args: Pydantic model with 'inputs' attribute containing loop input data
        :param streaming: Whether to stream the response (should be True)
        :return: SSE streaming generator
        :raises ValueError: If the snippet has no draft workflow
        """
        snippet_service = SnippetService()
        workflow = snippet_service.get_draft_workflow(snippet=snippet)
        if not workflow:
            raise ValueError("Workflow not initialized")

        app_proxy = _SnippetAsApp(snippet)

        return WorkflowAppGenerator.convert_to_event_stream(
            WorkflowAppGenerator().single_loop_generate(
                app_model=app_proxy,  # type: ignore[arg-type]
                workflow=workflow,
                node_id=node_id,
                user=user,
                args=args,  # type: ignore[arg-type]
                streaming=streaming,
            )
        )

    @staticmethod
    def parse_files(workflow: Workflow, files: list[dict] | None = None) -> Sequence[File]:
        """
        Parse file mappings into File objects based on workflow configuration.

        :param workflow: Workflow instance for file upload config
        :param files: Raw file mapping dicts
        :return: Parsed File objects
        """
        files = files or []
        file_extra_config = FileUploadConfigManager.convert(workflow.features_dict, is_vision=False)
        if file_extra_config is None:
            return []
        return file_factory.build_from_mappings(
            mappings=files,
            tenant_id=workflow.tenant_id,
            config=file_extra_config,
        )
