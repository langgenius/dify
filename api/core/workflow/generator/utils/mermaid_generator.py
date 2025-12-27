import logging
from typing import Any

logger = logging.getLogger(__name__)


def generate_mermaid(workflow_data: dict[str, Any]) -> str:
    """
    Generate a Mermaid flowchart from workflow data consisting of nodes and edges.

    Args:
        workflow_data: Dict containing 'nodes' (list) and 'edges' (list)

    Returns:
        String containing the Mermaid flowchart syntax
    """
    nodes = workflow_data.get("nodes", [])
    edges = workflow_data.get("edges", [])

    # DEBUG: Log input data
    logger.debug("[MERMAID] Input nodes count: %d", len(nodes))
    logger.debug("[MERMAID] Input edges count: %d", len(edges))
    for i, node in enumerate(nodes):
        logger.debug(
            "[MERMAID] Node %d: id=%s, type=%s, title=%s", i, node.get("id"), node.get("type"), node.get("title")
        )
    for i, edge in enumerate(edges):
        logger.debug(
            "[MERMAID] Edge %d: source=%s, target=%s, sourceHandle=%s",
            i,
            edge.get("source"),
            edge.get("target"),
            edge.get("sourceHandle"),
        )

    lines = ["flowchart TD"]

    # 1. Define Nodes
    # Format: node_id["title<br/>type"] or similar
    # We will use the Vibe Workflow standard format: id["type=TYPE|title=TITLE"]
    # Or specifically for tool nodes: id["type=tool|title=TITLE|tool=TOOL_KEY"]

    # Map of original IDs to safe Mermaid IDs
    id_map = {}

    def get_safe_id(original_id: str) -> str:
        if original_id == "end":
            return "end_node"
        if original_id == "subgraph":
            return "subgraph_node"
        # Mermaid IDs should be alphanumeric.
        # If the ID has special chars, we might need to escape or hash, but Vibe usually generates simple IDs.
        # We'll trust standard IDs but handle the reserved keyword 'end'.
        return original_id

    for node in nodes:
        node_id = node.get("id")
        if not node_id:
            continue

        safe_id = get_safe_id(node_id)
        id_map[node_id] = safe_id

        node_type = node.get("type", "unknown")
        title = node.get("title", "Untitled")

        # Escape quotes in title
        safe_title = title.replace('"', "'")

        if node_type == "tool":
            config = node.get("config", {})
            # Try multiple fields for tool reference
            tool_ref = (
                config.get("tool_key")
                or config.get("tool")
                or config.get("tool_name")
                or node.get("tool_name")
                or "unknown"
            )
            node_def = f'{safe_id}["type={node_type}|title={safe_title}|tool={tool_ref}"]'
        else:
            node_def = f'{safe_id}["type={node_type}|title={safe_title}"]'

        lines.append(f"  {node_def}")

    # 2. Define Edges
    # Format: source --> target

    # Track defined nodes to avoid edge errors
    defined_node_ids = {n.get("id") for n in nodes if n.get("id")}

    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")

        # Skip invalid edges
        if not source or not target:
            continue

        if source not in defined_node_ids or target not in defined_node_ids:
            # Log skipped edges for debugging
            logger.warning(
                "[MERMAID] Skipping edge: source=%s (exists=%s), target=%s (exists=%s)",
                source,
                source in defined_node_ids,
                target,
                target in defined_node_ids,
            )
            continue

        safe_source = id_map.get(source, source)
        safe_target = id_map.get(target, target)

        # Handle conditional branches (true/false) if present
        # In Dify workflow, sourceHandle is often used for this
        source_handle = edge.get("sourceHandle")
        label = ""

        if source_handle == "true":
            label = "|true|"
        elif source_handle == "false":
            label = "|false|"
        elif source_handle and source_handle != "source":
            # For question-classifier or other multi-path nodes
            # Clean up handle for display if needed
            safe_handle = str(source_handle).replace('"', "'")
            label = f"|{safe_handle}|"

        edge_line = f"  {safe_source} -->{label} {safe_target}"
        logger.debug("[MERMAID] Adding edge: %s", edge_line)
        lines.append(edge_line)

    # Start/End nodes are implicitly handled if they are in the 'nodes' list
    # If not, we might need to add them, but usually the Builder should produce them.

    result = "\n".join(lines)
    logger.debug("[MERMAID] Final output:\n%s", result)
    return result
