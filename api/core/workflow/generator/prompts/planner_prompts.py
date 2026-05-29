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
- "tool"                — call a Dify built-in / plugin tool (e.g. web search).
- "if-else"             — conditional branch.
- "question-classifier" — route to a labelled branch based on the input.
- "parameter-extractor" — extract structured params from free text using LLM.

# Rules

1. Always start with exactly one "start" node.
2. End with exactly one "end" (Workflow mode) or "answer" (Advanced Chat mode).
3. Keep it simple — prefer 3–6 nodes total. Do NOT add nodes "just in case".
4. Each node "label" must be a short, human-readable, Title-Case name (≤ 25 chars).
5. Each node "purpose" is one sentence explaining what it does in this workflow.
6. Output strictly the JSON object — no prose, no Markdown, no code fences.

# Output schema

{
  "title": "<≤ 40-char title of the workflow>",
  "description": "<one-sentence summary>",
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

{ideal_output_section}{tool_catalogue_section}\
Return the JSON plan now.
"""


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
