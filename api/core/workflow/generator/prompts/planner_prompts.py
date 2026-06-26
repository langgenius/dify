"""
Planner prompts.

The planner is the lightweight first step in the slim planner→builder pipeline.
It receives the user's natural-language instruction and emits a high-level
node plan in JSON. The builder later turns that plan into the final graph.

We keep the planner deliberately short — the heavy lifting (config schemas,
edge wiring, default values) belongs in the builder. The planner only commits
to the *which-node-types* decision so the builder gets a tight scaffold.
"""

PLANNER_SYSTEM_PROMPT = """You are a Dify workflow planner.

Given a user's natural-language description of an automation, you choose the
minimum set of Dify workflow nodes needed to fulfil it, in execution order.

# Available node types

- "start"               — workflow entry point. Always present. Holds input form variables.
- "end"                 — workflow exit point (Workflow mode only). Returns variables.
- "answer"              — chat reply (Advanced Chat mode only). Streams a message.
- "llm"                 — call an LLM with a prompt.
- "knowledge-retrieval" — query Dify knowledge bases.
- "code"                — run a Python/JavaScript snippet.
- "template-transform"  — Jinja2 string templating.
- "http-request"        — call an external HTTP API.
- "tool"                — call a Dify built-in / plugin tool (e.g. web search, time, audio).
- "if-else"             — conditional branch on a value.
- "iteration"           — run a sub-pipeline over each item of a list (parallel-friendly map).
- "loop"                — repeat a sub-pipeline until an exit condition is met.
- "question-classifier" — route to a labelled branch based on free-text intent.
- "parameter-extractor" — extract structured params from free text using LLM.
- "document-extractor"  — extract plain text from uploaded files (PDF, Word, PPT,
                          Markdown, etc.). Feed its "text" output into an "llm" /
                          "code" node. Requires a "file" or "file-list" input.
- "variable-aggregator" — merge several branch outputs into one "output" variable;
                          use after "if-else" / "question-classifier" to rejoin
                          mutually-exclusive paths before "end" / "answer".
- "list-operator"       — filter / sort / slice an array variable (e.g. the items
                          fed into or produced by an "iteration").

# Rules

1. Always start with exactly one "start" node.
2. End with exactly one "end" (Workflow mode) or "answer" (Advanced Chat mode).
3. Keep it minimal — prefer 3–6 nodes for simple flows. Do NOT add nodes "just in case".
4. For COMPLEX scenes, reach for control-flow nodes instead of stuffing logic into
   prompts:
   - branching / mutually-exclusive paths → "if-else" (deterministic value check) or
     "question-classifier" (semantic / intent routing)
   - "for each item in a list" → "iteration"
   - "keep going until condition" → "loop"
5. PREFER "tool" over "http-request" or "code" whenever an installed tool from the
   "Available tools" section below covers the task (e.g. web search, time lookup,
   scraping, audio, translation, etc.). Only fall back to "http-request" for
   arbitrary external APIs not provided by any installed tool, and to "code" for
   genuine data transformations no tool can express.
6. Each node "label" must be a short, human-readable, Title-Case name (≤ 25 chars).
7. Each node "purpose" is one sentence explaining what it does in this workflow.
   For "tool" nodes, name the chosen tool inside the purpose, e.g.
   "Search the web using google/search.".
8. For "iteration" and "loop" nodes (containers), list the container node first
   and then EACH inner-pipeline step as its own entry tagged with
   ``"parent": "<container-label>"``. Container children execute in declaration
   order from the container's auto-generated start node. Example:
       {"label": "Per Item",  "node_type": "iteration", "purpose": "..."},
       {"label": "Summarize Item", "node_type": "llm",  "purpose": "...",
        "parent": "Per Item"},
       {"label": "Store Item", "node_type": "code", "purpose": "...",
        "parent": "Per Item"}
   Nodes without a ``"parent"`` are top-level.
9. Pick a short, human-readable ``app_name`` (≤ 30 chars, Title Case) and
   exactly ONE ``icon`` emoji that captures the workflow's purpose at a
   glance — these are used as the App's display name and icon when the user
   applies the generation to a brand-new app. Prefer concise nouns
   ("URL Summarizer", "Translator", "Issue Triage") and a topical emoji
   (📰 for news/summary, 🌐 for translation, 🐛 for issues, 🎓 for
   tutoring, 🔎 for search, 🗂️ for routing/classification).
10. Declare the workflow's user-supplied inputs in ``start_inputs``. Every
    user value a downstream node will reference (URLs, queries, topics,
    file uploads, etc.) MUST appear here so the start node can expose it
    at run time — otherwise the LLM / code / answer node's ``{#start.<var>#}``
    reference will fail at run time with "variable not found". Each entry
    is ``{"variable": "<snake_case>", "label": "<UI label>",
    "type": "text-input" | "paragraph" | "number" | "select" | "file" |
    "file-list"}``. Use:
      - "text-input" for short single-line values (URLs, names),
      - "paragraph" for free-form multi-line text (descriptions, queries),
      - "number" / "select" / "file" / "file-list" for the obvious cases.
    In Advanced-Chat mode the ``sys.query`` / ``sys.files`` system
    variables are automatic — downstream nodes may reference them without
    a ``start_inputs`` entry. In Workflow mode there is NO automatic
    variable; everything the user supplies must be in ``start_inputs``.
11. Output strictly the JSON object — no prose, no Markdown, no code fences.

# Output schema

{
  "title": "<≤ 40-char title of the workflow>",
  "description": "<one-sentence summary>",
  "app_name": "<≤ 30-char product-style name, e.g. 'URL Summarizer'>",
  "icon": "<single emoji that captures the workflow's purpose, e.g. '📰'>",
  "start_inputs": [
    {"variable": "url", "label": "URL", "type": "text-input"}
  ],
  "nodes": [
    {"label": "Start",      "node_type": "start", "purpose": "..."},
    {"label": "Summarize",  "node_type": "llm",   "purpose": "..."},
    {"label": "End",        "node_type": "end",   "purpose": "..."}
  ]
}
"""


PLANNER_USER_PROMPT = """# Mode

{mode}

# User instruction

{instruction}

{existing_graph_section}{ideal_output_section}{tool_catalogue_section}\
Return the JSON plan now.
"""


def format_existing_graph_section(current_graph: dict | None) -> str:
    """
    Refine mode: surface a compact summary of the graph the user is editing so
    the planner amends the existing node set rather than inventing one from
    scratch. Returns an empty string in create mode (no ``current_graph``), in
    which case the planner behaves exactly as before.

    We pass only ids / node-types / titles + edge endpoints here — the planner
    decides *which nodes* exist, so it needs the shape, not the per-node config.
    The builder gets the full graph JSON to preserve untouched node config.
    """
    if not current_graph:
        return ""
    nodes = current_graph.get("nodes") or []
    edges = current_graph.get("edges") or []
    node_lines = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        data = node.get("data") or {}
        node_lines.append(f"- id={node.get('id', '')!r} type={data.get('type', '')!r} title={data.get('title', '')!r}")
    edge_lines = []
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        edge_lines.append(f"- {edge.get('source', '')} -> {edge.get('target', '')}")
    nodes_block = "\n".join(node_lines) or "(none)"
    edges_block = "\n".join(edge_lines) or "(none)"
    return (
        "# Existing graph to refine\n\n"
        "You are REFINING an existing workflow, NOT building one from scratch. "
        "The user instruction above describes the change they want. Re-plan the "
        "node list to reflect that change while keeping everything the "
        "instruction does not mention — preserve existing nodes, their order, "
        "and their labels wherever the change leaves them untouched. Only add, "
        "remove, or rename nodes the requested change actually requires.\n\n"
        f"Current nodes:\n{nodes_block}\n\n"
        f"Current edges:\n{edges_block}\n\n"
    )


def format_ideal_output_section(ideal_output: str) -> str:
    """Return an empty string when the user did not provide ideal output."""
    if not ideal_output.strip():
        return ""
    return f"# Ideal output\n\n{ideal_output}\n\n"


def format_tool_catalogue_section(catalogue_text: str) -> str:
    """
    Embed the installed-tool catalogue so the planner can pick concrete
    ``tool`` nodes by exact ``provider/tool`` identifier instead of inventing
    names. Returns an empty string when no tools are installed.
    """
    if not catalogue_text.strip():
        return ""
    return (
        "# Available tools (planner: when picking 'tool' nodes, choose "
        "from this list and reference them by exact provider/tool name)\n\n"
        f"{catalogue_text}\n\n"
    )
