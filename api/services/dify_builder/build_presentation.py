"""Bounded Build completion copy from applied node identities, separate from diffs."""

import re
from collections.abc import Sequence

from core.dify_builder.models import ApplyResult, Graph, MutationIntent

# Native node names are display fallbacks, never inferred from internal IDs.
_NATIVE_NAMES = {
    "start": ("Start", "开始"),
    "end": ("End", "结束"),
    "answer": ("Answer", "直接回复"),
    "llm": ("LLM", "大语言模型"),
    "knowledge-retrieval": ("Knowledge Retrieval", "知识检索"),
    "code": ("Code", "代码"),
    "template-transform": ("Template", "模板转换"),
    "question-classifier": ("Question Classifier", "问题分类器"),
    "if-else": ("IF/ELSE", "条件分支"),
    "http-request": ("HTTP Request", "HTTP 请求"),
    "tool": ("Tool", "工具"),
    "agent": ("Agent", "智能体"),
    "parameter-extractor": ("Parameter Extractor", "参数提取器"),
    "variable-aggregator": ("Variable Aggregator", "变量聚合器"),
    "assigner": ("Variable Assigner", "变量赋值"),
    "document-extractor": ("Document Extractor", "文档提取器"),
    "list-operator": ("List Operator", "列表操作"),
    "iteration": ("Iteration", "迭代"),
    "iteration-start": ("Iteration Start", "迭代开始"),
    "loop": ("Loop", "循环"),
    "loop-start": ("Loop Start", "循环开始"),
    "loop-end": ("Loop End", "循环结束"),
}
_MARKDOWN = re.compile(r"([\\`*_{}\[\]()<>#+\-.!|~])")


def build_node_summary(
    result: ApplyResult, before_graph: Graph, applied_intents: Sequence[MutationIntent], reply_language: str
) -> str:
    """Name actual affected nodes; proposals and raw diff text cannot prove changes.

    Result titles reflect the applied graph. The already-read draft and validated
    create intents supply native type fallbacks only, without replaying mutations
    or reading a potentially newer graph after the write.
    """
    chinese = reply_language.lower().startswith("zh")
    native_types: dict[str, str] = {}
    for node in before_graph.get("nodes", []):
        if not isinstance(node, dict):
            continue
        node_id, data = node.get("id"), node.get("data")
        if isinstance(node_id, str) and isinstance(data, dict) and isinstance(data.get("type"), str):
            native_types[node_id] = data["type"]
    for intent in applied_intents:
        node_id, node_type = intent.args.get("node_id"), intent.args.get("node_type")
        if intent.op == "create_node" and isinstance(node_id, str) and isinstance(node_type, str):
            native_types[node_id] = node_type

    titles = {node.node_id: node.title for node in result.nodes}
    node_ids = list(dict.fromkeys([*result.changed_nodes, *titles]))
    if not node_ids:
        return "- 没有新增的节点变更。" if chinese else "- No additional node changes."

    labels: list[str] = []
    for node_id in node_ids[:8]:
        title = titles.get(node_id)
        label = " ".join(title.split()) if isinstance(title, str) else ""
        if not label or label == node_id:
            label = _NATIVE_NAMES.get(native_types.get(node_id, ""), ("Node", "节点"))[int(chinese)]
        # Bound generated prose and keep titles literal within the Markdown body.
        if len(label) > 80:
            label = label[:79] + "…"
        labels.append(_MARKDOWN.sub(r"\\\1", label))
    separator = "、" if chinese else ", "
    body = separator.join(labels)
    remaining = len(node_ids) - len(labels)
    if remaining:
        body += f"（另有 {remaining} 个）" if chinese else f" (+{remaining} more)"
    return ("- 涉及节点：" if chinese else "- Affected nodes: ") + body
