"""Workflow-owned document extractor node variants.

Dify keeps a local wrapper around Graphon's document extractor so workflow
runtime behavior can remain stable without mutating Graphon classes at import
time. The only divergence today is the historical Excel per-sheet fallback
behavior that existing workflows already depend on.
"""

from graphon.nodes.document_extractor import DocumentExtractorNodeData, UnstructuredApiConfig

from .node import DocumentExtractorNode, extract_text_from_excel

__all__ = [
    "DocumentExtractorNode",
    "DocumentExtractorNodeData",
    "UnstructuredApiConfig",
    "extract_text_from_excel",
]
