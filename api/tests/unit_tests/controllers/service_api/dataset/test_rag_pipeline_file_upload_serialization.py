"""
Unit tests for Service API knowledge pipeline file-upload serialization.
"""

import ast
from pathlib import Path


def test_file_upload_created_at_is_isoformat_string():
    api_dir = Path(__file__).resolve().parents[5]
    rag_pipeline_workflow = (
        api_dir / "controllers" / "service_api" / "dataset" / "rag_pipeline" / "rag_pipeline_workflow.py"
    )

    tree = ast.parse(rag_pipeline_workflow.read_text(encoding="utf-8"))
    created_at_expr = None

    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        if node.name != "KnowledgebasePipelineFileUploadApi":
            continue
        for body_node in node.body:
            if not isinstance(body_node, ast.FunctionDef):
                continue
            if body_node.name != "post":
                continue
            for inner in ast.walk(body_node):
                if not isinstance(inner, ast.Return):
                    continue
                if not isinstance(inner.value, ast.Tuple) or not inner.value.elts:
                    continue
                response_dict = inner.value.elts[0]
                if not isinstance(response_dict, ast.Dict):
                    continue
                for key, value in zip(response_dict.keys, response_dict.values, strict=False):
                    if isinstance(key, ast.Constant) and key.value == "created_at":
                        created_at_expr = value

    assert created_at_expr is not None

    isoformat_call = created_at_expr.body if isinstance(created_at_expr, ast.IfExp) else created_at_expr
    assert isinstance(isoformat_call, ast.Call)
    assert isinstance(isoformat_call.func, ast.Attribute)
    assert isoformat_call.func.attr == "isoformat"

