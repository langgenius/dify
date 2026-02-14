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

import json
import logging
from collections.abc import Generator, Mapping, Sequence
from typing import Any, Union

from sqlalchemy.orm import make_transient

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

    # Specific ID for the injected virtual Start node so it can be recognised
    _VIRTUAL_START_NODE_ID = "__snippet_virtual_start__"

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

        If the workflow graph has no Start node, a virtual Start node is injected
        in-memory so that:
        1. Graph validation passes (root node must have execution_type=ROOT).
        2. User inputs are processed into the variable pool by the StartNode logic.

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

        # Inject a virtual Start node when the graph doesn't have one.
        workflow = cls._ensure_start_node(workflow, snippet)

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
    def _ensure_start_node(cls, workflow: Workflow, snippet: CustomizedSnippet) -> Workflow:
        """
        Return *workflow* with a Start node.

        If the graph already contains a Start node, the original workflow is
        returned unchanged.  Otherwise a virtual Start node is injected and the
        workflow object is detached from the SQLAlchemy session so the in-memory
        change is never flushed to the database.
        """
        graph_dict = workflow.graph_dict
        nodes: list[dict[str, Any]] = graph_dict.get("nodes", [])

        has_start = any(node.get("data", {}).get("type") == "start" for node in nodes)
        if has_start:
            return workflow

        modified_graph = cls._inject_virtual_start_node(
            graph_dict=graph_dict,
            input_fields=snippet.input_fields_list,
        )

        # Detach from session to prevent accidental DB persistence of the
        # modified graph.  All attributes remain accessible for read.
        make_transient(workflow)
        workflow.graph = json.dumps(modified_graph)
        return workflow

    @classmethod
    def _inject_virtual_start_node(
        cls,
        graph_dict: Mapping[str, Any],
        input_fields: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Build a new graph dict with a virtual Start node prepended.

        The virtual Start node is wired to every existing node that has no
        incoming edges (i.e. the current root candidates).  This guarantees:

        :param graph_dict: Original graph configuration.
        :param input_fields: Snippet input field definitions from
            ``CustomizedSnippet.input_fields_list``.
        :return: New graph dict containing the virtual Start node and edges.
        """
        nodes: list[dict[str, Any]] = list(graph_dict.get("nodes", []))
        edges: list[dict[str, Any]] = list(graph_dict.get("edges", []))

        # Identify nodes with no incoming edges.
        nodes_with_incoming: set[str] = set()
        for edge in edges:
            target = edge.get("target")
            if isinstance(target, str):
                nodes_with_incoming.add(target)
        root_candidate_ids = [n["id"] for n in nodes if n["id"] not in nodes_with_incoming]

        # Build Start node ``variables`` from snippet input fields.
        start_variables: list[dict[str, Any]] = []
        for field in input_fields:
            var: dict[str, Any] = {
                "variable": field.get("variable", ""),
                "label": field.get("label", field.get("variable", "")),
                "type": field.get("type", "text-input"),
                "required": field.get("required", False),
                "options": field.get("options", []),
            }
            if field.get("max_length") is not None:
                var["max_length"] = field["max_length"]
            start_variables.append(var)

        virtual_start_node: dict[str, Any] = {
            "id": cls._VIRTUAL_START_NODE_ID,
            "data": {
                "type": "start",
                "title": "Start",
                "variables": start_variables,
            },
        }

        # Create edges from virtual Start to each root candidate.
        new_edges: list[dict[str, Any]] = [
            {
                "source": cls._VIRTUAL_START_NODE_ID,
                "sourceHandle": "source",
                "target": root_id,
                "targetHandle": "target",
            }
            for root_id in root_candidate_ids
        ]

        return {
            **graph_dict,
            "nodes": [virtual_start_node, *nodes],
            "edges": [*edges, *new_edges],
        }

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
