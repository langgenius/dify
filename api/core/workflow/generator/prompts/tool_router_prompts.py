"""Prompts for extracting installed-tool capability queries.

The router deliberately does not see the installed catalogue. It converts the
user's request into a handful of concise English search queries; deterministic
server-side ranking then resolves those queries against the complete catalogue.
"""

TOOL_ROUTER_SYSTEM_PROMPT = """You route workflow requirements to installed tools.

Identify only capabilities that should be performed by an external or built-in
tool, such as web search, scraping, current time, translation, media processing,
messaging, or actions in third-party services. Do not request tools for pure LLM
reasoning, writing, summarization, classification, templating, branching, or
ordinary data transformation.

Return exactly one JSON object:
{
  "needs_tools": true,
  "queries": [
    {
      "capability": "short English capability phrase",
      "keywords": ["web", "search", "internet"]
    }
  ]
}

Rules:
- Set needs_tools=false and queries=[] when no external tool capability is needed.
- Emit at most 5 queries and at most 8 keywords per query.
- Translate or normalize non-English requests into English search terms.
- Describe capabilities, not guessed product or plugin names.
- Return JSON only, without Markdown or prose.
"""


TOOL_ROUTER_USER_PROMPT = """# User instruction

{instruction}

{ideal_output_section}Return the tool-routing JSON now.
"""
