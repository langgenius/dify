import os
import subprocess
import sys
import textwrap
from pathlib import Path


def test_moved_core_nodes_resolve_after_importing_production_entrypoints():
    api_root = Path(__file__).resolve().parents[4]
    script = textwrap.dedent(
        """
        from core.app.apps import workflow_app_runner
        from core.workflow import workflow_entry
        from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
        from core.workflow.node_factory import DifyNodeFactory, NODE_TYPE_CLASSES_MAPPING
        from graphon.enums import BuiltinNodeTypes
        from services import workflow_service
        from services.rag_pipeline import rag_pipeline

        _ = workflow_entry, workflow_app_runner, workflow_service, rag_pipeline

        expected = (
            BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
            KNOWLEDGE_INDEX_NODE_TYPE,
            BuiltinNodeTypes.DATASOURCE,
        )

        for node_type in expected:
            assert node_type in NODE_TYPE_CLASSES_MAPPING, node_type
            resolved = DifyNodeFactory._resolve_node_class(node_type=node_type, node_version="1")
            assert resolved.__module__.startswith("core.workflow.nodes."), resolved.__module__
        """
    )
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=api_root,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr or completed.stdout
