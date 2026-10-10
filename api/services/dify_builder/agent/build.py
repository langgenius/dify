"""Real LLM cognition for Dify Builder's Build mode (light methods).

Pure functions called by ``LlmBuilderAgent`` for Build cognition.
Each degrades to an honest result on model-None / provider-error / parse-fail
rather than crashing the advance. build_nodes lives in the same module
(added in Task A6)."""

import json
import logging
import re
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import json_repair

from core.app.app_config.entities import ModelConfig
from core.dify_builder import urls
from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import BuildNodesResult, MutationIntent
from graphon.enums import BUILT_IN_NODE_TYPES
from services.dify_builder import preflight
from services.dify_builder.agent import form_schema, graph_translate, llm, resources, user_supplied
from services.dify_builder.agent.model_resolver import resolve_model_instance
from services.dify_builder.agent.resources import ResourceRef
from services.workflow_generator_service import WorkflowGeneratorService

logger = logging.getLogger(__name__)

# A reply longer than this is prose, not a title. Well above
# ``naming.MAX_NAME_LENGTH`` so a good-but-long title is trimmed downstream
# rather than rejected here.
_MAX_PROPOSED_NAME_CHARS = 80


def analyze_goal(
    model,
    goal_text: str,
    on_reasoning: Callable[[str], None] | None = None,
    *,
    reply_language: str | None = None,
) -> dict[str, Any]:
    if model is None:
        return _degraded_form(goal_text)
    system = (
        "You are a Dify workflow requirements analyst. Given a build goal, propose 3-6 "
        "clarifying requirement fields SHAPED BY THE GOAL, and a sensible default value per "
        "field. The user already typed the goal and you are given it below, so never propose a "
        'field that restates it -- no "requirement description", "goal" or "what do you want" field. '
        "Every field must ask for something the goal does not already say. "
        "Never invent a URL/endpoint, API key, token, password, or account/resource id "
        "the goal does not state -- give such a field an empty string as its default so the "
        f"user fills it in. {form_schema.FORM_FIELD_TYPE_GUIDANCE}"
        'Reply with ONLY JSON: {"fields": [{"key": "...", "label": "...", "type": "...", '
        '"options": ["..."]}], "values": {"<key>": <default>}}.'
    )
    if reply_language:
        system += (
            f" Write human-facing field labels, descriptions, hints, placeholders, select options, and generated "
            f"defaults in the session reply language (BCP-47: {reply_language}). Keep JSON keys, field keys, "
            "and field type enums in English. Preserve literal business values supplied in the goal, including "
            "names, currencies, URLs, and credentials. For each select field, the default value must exactly match "
            "one of its options."
        )
    else:
        system += (
            " Write human-facing field labels, descriptions, hints, placeholders, select options, and generated "
            "defaults in the same language as the user's input. Keep JSON keys, field keys, and field type "
            "enums in English. Preserve literal business values supplied in the goal. For each select field, "
            "the default value must exactly match one of its options."
        )
    try:
        data = llm.invoke_json(model, system=system, user=f"GOAL:\n{goal_text}", on_reasoning=on_reasoning)
    except Exception:
        return _degraded_form(goal_text)
    fields = data.get("fields")
    values = data.get("values")
    if not isinstance(fields, list) or not isinstance(values, dict):
        return _degraded_form(goal_text)
    scrubbed_values = _scrub_invented_defaults(values, goal_text)
    answered_values = _answer_goal_restatements(fields, scrubbed_values, goal_text)
    explained_fields = _explain_blank_fields(fields, answered_values)
    return {
        "fields": form_schema.reconcile_form_fields(explained_fields, answered_values),
        "values": answered_values,
    }


def _is_invented_literal(value: Any, key: str | None, goal_text: str) -> bool:
    """True when ``value`` (found under ``key``, possibly nested inside a
    field's dict/list default) is a URL or credential the LLM invented
    rather than one the goal actually states.

    An off-goal URL -- one whose host the goal never names, with or without a
    scheme (``user_supplied.is_user_supplied_host``) -- blanks the field
    regardless of key. A credential-shaped placeholder (``<...>``,
    ``YOUR_API_KEY``, ...) only blanks it when the
    value is under a credential-named key (``user_supplied.is_credential_key``,
    decided by the key's LAST segment -- not by containing "token" or
    "password" anywhere) or the value itself starts with an auth scheme
    (``Bearer ``/``Basic ``/``Token ``); otherwise an ordinary default like
    ``"Dear <customer_name>,"`` would be blanked for no reason. A
    credential-keyed value that isn't placeholder-shaped but also never
    appears in the goal (e.g. an invented ``sk-live-...`` string) is still
    caught via ``is_user_supplied_secret``.
    """
    if isinstance(value, dict):
        return any(_is_invented_literal(v, k, goal_text) for k, v in value.items())
    if isinstance(value, list):
        return any(_is_invented_literal(item, None, goal_text) for item in value)
    if not isinstance(value, str):
        return False
    if any(not user_supplied.is_user_supplied_host(host, goal_text) for host in user_supplied.url_hosts(value)):
        return True
    credential_key = key is not None and user_supplied.is_credential_key(key)
    stripped = user_supplied.strip_auth_scheme(value)
    if (credential_key or stripped != value) and user_supplied.CREDENTIAL_PLACEHOLDER_RE.search(stripped):
        return True
    if credential_key and not user_supplied.is_user_supplied_secret(value, goal_text):
        return True
    return False


def _scrub_invented_defaults(values: dict[str, Any], goal_text: str) -> dict[str, Any]:
    """Blank any top-level field whose default is an invented URL or
    credential rather than one the goal states (S5b/F2: analysis prefilled
    ``render_api_url=https://api.yourcompany.com/...`` and
    ``Authorization: Bearer YOUR_API_KEY`` for a goal that named neither).

    The whole field is replaced with ``""`` -- even one whose default was a
    dict -- so the user is prompted to fill it in themselves rather than the
    workflow running against a host or secret that doesn't exist.
    """
    blanked = [key for key, value in values.items() if _is_invented_literal(value, key, goal_text)]
    if not blanked:
        return values
    scrubbed = dict(values)
    for key in blanked:
        scrubbed[key] = ""
    logger.info("dify_builder: blanked invented default(s) for %s", ", ".join(sorted(blanked)))
    return scrubbed


# A requirements field whose name is one of these is asking the user to restate
# the goal they already typed (PM report 2026-09-29: "需求描述" shipped blank, so
# there was nothing to write). ``_degraded_form`` has always answered that
# question with ``goal_text``; these let the LLM path do the same.
#
# Deliberately EXACT names, not substrings, and deliberately without a bare
# "description"/"描述": those are ambiguous (a report description is not the
# goal), and writing the goal into the wrong box is worse than leaving it
# blank. The prompt rule is the first line of defence; this is the backstop.
_GOAL_RESTATING_FIELD_NAMES = frozenset(
    {
        "goal",
        "goals",
        "usergoal",
        "usergoals",
        "workflowgoal",
        "objective",
        "objectives",
        "requirement",
        "requirements",
        "userrequirement",
        "userrequirements",
        "requirementdescription",
        "requirementsdescription",
        "requirementdetail",
        "requirementdetails",
        "requirementoverview",
        "requirementsummary",
        "taskdescription",
        "userrequest",
        "userneed",
        "userneeds",
        "需求",
        "需求描述",
        "需求说明",
        "需求详情",
        "需求内容",
        "需求概述",
        "用户需求",
        "目标",
        "目标描述",
        "工作流目标",
        "任务描述",
    }
)

# Types that cannot hold the goal sentence: a select would gain a value none of
# its options offer, and the rest are not free text. Anything else -- including
# a missing or unknown type -- becomes a text box downstream
# (``handlers_fix.build_form_fields`` clamps unknown types to "text"), so it can.
_NON_TEXT_FORM_FIELD_TYPES = frozenset({"bool", "json", "json_object", "number", "select"})

_FIELD_NAME_SEPARATORS = re.compile(r"[\s_\-:：*]+")


# Shown on a requirements field that arrived empty, so it reads as a question
# the Builder is asking rather than a box someone forgot to fill. Lives in
# ``strings.PLAIN`` so the Localizer translates it with the rest of the card.
BLANK_FIELD_HINT = "Not stated in your request — add it if you have one."


def _explain_blank_fields(fields: list[Any], values: dict[str, Any]) -> list[Any]:
    """Attach ``BLANK_FIELD_HINT`` to every field that ends up without a value.

    A field is blank either because the model had nothing to offer or because
    ``_scrub_invented_defaults`` blanked an invented credential ON PURPOSE.
    Both look identical to the user, so both get the same explanation. A field
    the model already hinted keeps its own wording.
    """
    explained: list[Any] = []
    for field_spec in fields:
        if not isinstance(field_spec, dict) or not field_spec.get("key"):
            explained.append(field_spec)
            continue
        value = values.get(str(field_spec["key"]))
        blank = value is None or (isinstance(value, str) and not value.strip())
        if not blank or field_spec.get("hint"):
            explained.append(field_spec)
            continue
        explained.append({**field_spec, "hint": BLANK_FIELD_HINT})
    return explained


def _restates_the_goal(field: dict[str, Any]) -> bool:
    """True when this field's key or label just asks for the goal back."""
    for raw in (field.get("key"), field.get("label")):
        if not isinstance(raw, str):
            continue
        if _FIELD_NAME_SEPARATORS.sub("", raw).strip().lower() in _GOAL_RESTATING_FIELD_NAMES:
            return True
    return False


def _answer_goal_restatements(fields: list[Any], values: dict[str, Any], goal_text: str) -> dict[str, Any]:
    """Fill any goal-restating field the model left blank with the goal itself.

    Repairs, never overwrites: a field the model actually answered keeps its
    answer, and a blank field that asks for something else -- a credential the
    scrubber blanked ON PURPOSE, say -- stays blank. Spraying the goal into
    every empty box would be worse than the bug this fixes.
    """
    answered = dict(values)
    for field_spec in fields:
        if not isinstance(field_spec, dict):
            continue
        raw_key = field_spec.get("key")
        if not raw_key:
            continue
        if field_spec.get("type") in _NON_TEXT_FORM_FIELD_TYPES:
            continue
        key = str(raw_key)
        current = answered.get(key)
        if current is not None and not (isinstance(current, str) and not current.strip()):
            continue
        if not _restates_the_goal(field_spec):
            continue
        answered[key] = goal_text
    return answered


def propose_app_name(
    model,
    goal_text: str,
    requirements: dict[str, Any],
    on_reasoning: Callable[[str], None] | None = None,
) -> str:
    """Name the app the way a person would title it (spec N1).

    Returns "" whenever it cannot beat the name already cut from the prompt --
    no model, a failed call, or a sentence instead of a title. The caller then
    keeps the derived name, so this never has to be right, only safe.
    """
    if model is None:
        return ""
    system = (
        "You name Dify apps. Given the goal the user typed, reply with a short title for "
        "the app -- a noun phrase naming what it does, at most 5 words, no trailing "
        "punctuation, no quotes, not a sentence and not an instruction. "
        "Write it in the same language the user wrote the goal in. "
        "Reply with ONLY the title."
    )
    user = f"GOAL:\n{goal_text}"
    if requirements:
        user += f"\n\nREQUIREMENTS:\n{json.dumps(requirements, ensure_ascii=False)[:1000]}"
    try:
        raw = llm.invoke_text(model, system=system, user=user, on_reasoning=on_reasoning).strip()
    except Exception:
        logger.warning("dify_builder: app-name proposal failed; keeping the derived name", exc_info=True)
        return ""
    # A sentence ("Sure! Here is a good name for...") is worse than the
    # mechanical cut, so accept only a title-shaped reply.
    first_line = raw.splitlines()[0].strip() if raw else ""
    if not first_line or len(first_line) > _MAX_PROPOSED_NAME_CHARS:
        return ""
    return first_line


def _degraded_form(goal_text: str) -> dict[str, Any]:
    return {
        "fields": [{"key": "goal", "label": "Goal", "type": "textarea", "options": []}],
        "values": {"goal": goal_text},
    }


# The node types a plan step may map to. This exists because the Builder's own
# planner previously had NO node vocabulary (ESQ1-279): it planned in business
# language ("Send a Feishu notification"), and the generator -- whose system
# prompt DOES carry a node whitelist -- was then handed steps it could not map
# onto any real node, failing only after the user had approved the plan.
#
# Deliberately Builder-only. The generator's own whitelist lives in the SHARED
# core/workflow/generator/prompts/planner_prompts.py, which cmd+K also uses and
# which this package must not touch. Keep the two conceptually aligned, but do
# not try to import across that boundary.
_DIFY_NODE_VOCABULARY = """\
- "start"               — workflow entry. Always present. Holds the input form variables.
- "end"                 — workflow exit. Returns the result.
- "llm"                 — call an LLM with a prompt.
- "code"                — run a Python/JavaScript snippet.
- "template-transform"  — Jinja2 string templating.
- "http-request"        — call an external HTTP API.
- "tool"                — call a Dify built-in or installed plugin tool (web search, Slack, JSON, …).
- "if-else"             — branch on a condition.
- "iteration"           — run a sub-pipeline over every item of a list.
- "loop"                — repeat a sub-pipeline until an exit condition holds.
- "question-classifier" — route to a labelled branch by free-text intent.
- "parameter-extractor" — pull structured fields out of free text with an LLM.
- "document-extractor"  — extract text from an uploaded file. Needs a file input.
- "variable-aggregator" — rejoin mutually-exclusive branches into one variable.
- "list-operator"       — filter / sort / slice an array variable.
- "assigner"            — update an existing conversation or loop variable."""


# How many ready tools the Builder's planner is shown. The ESQ1-302 tenant had
# 35; a cap keeps the prompt bounded on tenants with hundreds. Sorted by id so
# the listing is stable across calls.
_MAX_PLANNER_TOOLS = 40


def ready_tool_catalogue(tenant_id: str) -> list[ResourceRef]:
    """The installed tools the planner may name: ``ready`` ones only (an
    installed-but-unauthorized tool cannot cover a step), capped and sorted.
    A listing failure yields ``[]`` -- the plan then just cannot name tools,
    which is the pre-existing behaviour, never a crashed advance."""
    try:
        tools = resources.list_tenant_resources(tenant_id).tools
    except Exception:
        logger.warning("dify_builder: tool listing failed; planning without a tool catalogue", exc_info=True)
        return []
    ready = sorted((t for t in tools if t.readiness == "ready"), key=lambda t: t.id)
    return ready[:_MAX_PLANNER_TOOLS]


def _planner_tool_section(tools: Sequence[ResourceRef]) -> str:
    if not tools:
        return ""
    listing = "\n".join(f"- {t.id} — {t.label}" for t in tools)
    # "as a separate word": the generator pins a tool only on its id bounded by
    # non-word characters (tool_catalogue's identifier boundary), and CJK counts
    # as a word character -- "使用bowenliang123/..." never pins.
    return (
        "\n\n# Installed tools you may name (ready to use)\n"
        "When one of these covers a step, plan that step as a `tool` node and name the tool "
        "by its id -- write the id exactly as listed, as a separate word (with a space on "
        "each side, even in Chinese or Japanese text). An `http-request` endpoint must be "
        "user-supplied or a required Start input supplied at runtime -- never invent one.\n"
        f"{listing}"
    )


def _cognition_source(goal_text: str, requirements: dict[str, Any] | None) -> str:
    """Keep the full source in every source-dependent cognition payload."""
    return f"ORIGINAL GOAL:\n{goal_text}\n\nCONFIRMED REQUIREMENTS:\n" + json.dumps(
        requirements if requirements is not None else {}, ensure_ascii=False
    )


def _plan_schema_error(data: Any) -> str:
    """Describe shape errors without quoting source or model-generated content."""
    if not isinstance(data, dict):
        return f"The response must be an object, received {type(data).__name__}."
    if "plan" not in data:
        return "The required plan field is missing."
    plan = data["plan"]
    if not isinstance(plan, list):
        return f"The plan field must be a nonempty list of strings, received {type(plan).__name__}."
    if not plan:
        return "The plan field must contain at least one nonblank string."
    for index, item in enumerate(plan):
        if not isinstance(item, str):
            return f"The plan[{index}] field must be a nonblank string, received {type(item).__name__}."
        if not item.strip():
            return f"The plan[{index}] field is blank; every item must be a nonblank string."
    return ""


def propose_plan_v1(
    model,
    requirements: dict[str, Any],
    on_reasoning: Callable[[str], None] | None = None,
    *,
    tools: Sequence[ResourceRef] = (),
    goal_text: str = "",
) -> list[str]:
    """Return an intact plan or [], with at most one schema correction.

    The service-only source default supports direct callers during sequential
    adapter migration; runtime adapters must pass the original goal explicitly.
    Structural validity alone does not prove the plan covers the source.
    """
    if model is None:
        return []
    system = (
        "You are a Dify workflow planner. Given the original goal and confirmed requirements, "
        "propose an ordered list of concise build steps. Preserve requested actions and outputs; "
        "requirements may refine the goal, but do not silently resolve conflicting instructions.\n\n"
        "Every step MUST be implementable by exactly one of these Dify node types, and you "
        "may plan ONLY in these terms:\n\n"
        f"{_DIFY_NODE_VOCABULARY}\n\n"
        "Write each step as the work that node does, naming the node type. Good: "
        '"llm node drafts a reply from the ticket text". Bad: "Notify the team on Feishu" '
        "-- that names a product, not a node.\n\n"
        "Dify has no scheduler, database, email or messaging node. An external action can use "
        "a ready matching installed `tool` node, an `http-request` node with a user-supplied "
        "endpoint, or an `http-request` node whose endpoint is a required Start input supplied "
        "at runtime. A missing URL alone is not an unsupported capability: retain the requested "
        "HTTP action and require the endpoint input rather than skipping it. Reserve work "
        "outside the workflow for an actual unsupported capability. Do not replace a requested "
        "real file with Markdown or JSON success because an endpoint is absent. Endpoint "
        "deferral does not establish API availability, authentication, request schema or response "
        "schema; do not invent any of them. Resource mentions, including optional or negative "
        "mentions, do not alone require using a resource."
        f"{_planner_tool_section(tools)}\n\n"
        'Reply with ONLY JSON: {"plan": ["step", ...]}.'
    ) + llm.json_language_instruction("plan steps")
    source = _cognition_source(goal_text, requirements)
    user = source
    for attempt in range(2):
        try:
            # invoke_json retries internally; use one provider call per attempt
            # so parsing and schema correction share the same two-call budget.
            text = llm.invoke_text(model, system=system, user=user, on_reasoning=on_reasoning)
        except Exception:
            return []
        try:
            data = json_repair.loads(text)
        except Exception:
            data = None
        issue = _plan_schema_error(data)
        if not issue:
            return data["plan"]
        if attempt == 0:
            user = f"{source}\n\nSCHEMA CORRECTION:\n{issue} Reply with ONLY the complete corrected JSON object."
    return []


def discover_resources(
    model,
    tenant_id: str,
    plan_items: list[str],
    on_reasoning: Callable[[str], None] | None = None,
    *,
    goal_text: str = "",
    requirements: dict[str, Any] | None = None,
) -> list[ResourceOption]:
    inv = resources.list_tenant_resources(tenant_id)
    catalog = {r.id: ("plugin", r) for r in inv.tools}
    catalog.update({r.id: ("model", r) for r in inv.models})
    if not catalog or model is None:
        return []
    system = (
        "You are a Dify workflow resource recommender. From the AVAILABLE resources, pick the "
        "ids relevant to the original goal, confirmed requirements and plan. A mention alone "
        "does not require a resource; respect optional and negative source instructions. "
        "Each is listed with its readiness: 'ready' or 'missing_config' "
        "(installed but not authorized for this workspace, so it cannot actually be used) -- never "
        "recommend a missing_config resource. Use ONLY listed ids. Reply with ONLY JSON: "
        '{"resource_ids": ["<id>", ...]}.'
    )
    listing = "\n".join(f"- {rid} ({kind}, {ref.readiness}): {ref.label}" for rid, (kind, ref) in catalog.items())
    user = f"{_cognition_source(goal_text, requirements)}\n\nPLAN:\n{chr(10).join(plan_items)}\n\nAVAILABLE:\n{listing}"
    try:
        data = llm.invoke_json(model, system=system, user=user, on_reasoning=on_reasoning)
        chosen_ids = [rid for rid in (data.get("resource_ids") or []) if rid in catalog]
    except Exception:
        logger.warning("dify_builder: resource recommendation failed; recommending none", exc_info=True)
        chosen_ids = []
    # Recommending nothing is the honest answer when there is no signal -- no
    # model, a failed call, or a model that picked none. The old code fell back
    # to the whole tenant inventory, and because the client pre-checks every
    # recommendation and submits them by default, that silently bound dozens of
    # unrelated resources and appended their names to the plan fed to the
    # generator. The caller states the situation instead.
    return [
        ResourceOption(
            id=rid,
            label=catalog[rid][1].label,
            meta=catalog[rid][1].meta,
            kind=catalog[rid][0],
            readiness=catalog[rid][1].readiness,
        )
        for rid in chosen_ids
    ]


_GAP_SYSTEM = (
    "You check whether the original goal, confirmed requirements and workflow plan can be built "
    "from the resources listed. Respect optional and negative resource instructions; a mention "
    "alone is not a required invocation. A missing HTTP endpoint can be a required Start input "
    "provided at runtime; do not treat a missing URL alone as an unsupported capability or "
    "invent an API contract. Each resource is "
    "shown with its readiness: 'ready' or 'missing_config' -- installed but not authorized for "
    "this workspace, so it is not usable; treat a missing_config resource as unavailable, the "
    "same as if it were not listed at all. "
    "Name in ONE plain sentence any step no listed resource can perform, and say what "
    "capability is missing -- never which product to install. Reply with ONLY JSON: "
    '{"gap": "<sentence, or empty string when the plan is covered>"}.'
)


def assess_capability_gap(
    model,
    plan_items: list[str],
    options: list[ResourceOption],
    *,
    goal_text: str = "",
    requirements: dict[str, Any] | None = None,
) -> str:
    """One sentence naming what the workspace cannot do, or "".

    Grounded only in what is installed -- there is no marketplace lookup, so
    this says a capability is missing, never which plugin would supply it. A
    ``missing_config`` tool (installed but unauthorized) cannot actually cover
    a step, so it counts against the plan the same as if it weren't there at
    all -- the readiness the model is shown reflects that. A model we cannot
    reach reports no gap: inventing one would block a build that might be
    fine.
    """
    if model is None or not plan_items:
        return ""
    listing = "\n".join(f"- {o.id} ({o.kind}, {o.readiness}): {o.label}" for o in options) or "- (none)"
    try:
        data = llm.invoke_json(
            model,
            system=_GAP_SYSTEM + llm.json_language_instruction("the gap sentence"),
            user=(
                f"{_cognition_source(goal_text, requirements)}\n\n"
                f"PLAN:\n{chr(10).join(plan_items)}\n\nAVAILABLE:\n{listing}"
            ),
        )
    except Exception:
        logger.warning("dify_builder: capability-gap assessment failed", exc_info=True)
        return ""
    gap = data.get("gap")
    return str(gap).strip() if isinstance(gap, str) else ""


# Which plan step a resource kind covers, by the node vocabulary the planner
# writes its steps in (see _DIFY_NODE_VOCABULARY). Matched case-insensitively,
# as a whole word/phrase, because steps mix scripts ("tool节点：...").
_STEP_KEYWORDS_BY_KIND: dict[str, tuple[str, ...]] = {
    "model": ("llm", "question-classifier", "parameter-extractor"),
    "plugin": ("tool",),
}


def _term_in_step(item: str, term: str) -> bool:
    """Whether ``term`` names ``item``: case-insensitive, and bounded on both
    sides by a non-ASCII-alphanumeric character (or the string edge) so
    "tool" doesn't match inside "toolkit" and "llm" doesn't match inside
    "fulfillment". CJK characters, hyphens, colons and punctuation all count
    as boundaries, so "llm节点" and "tool节点" still match.
    """
    if not term:
        return False
    pattern = rf"(?<![a-z0-9]){re.escape(term.lower())}(?![a-z0-9])"
    return re.search(pattern, item.lower()) is not None


def _covering_step(plan_items: list[str], kind: str, ref: ResourceRef) -> int:
    """Index of the first step a resource covers: one naming the resource's
    id, else one naming its label, else one naming its kind's node type;
    ``-1`` when none does.

    The id comes first because the planner is told to name a tool by its id
    (``_planner_tool_section``): with two tool steps, the "tool" keyword alone
    would bind both tools to the first of them.
    """
    for term in (ref.id, ref.label):
        for index, item in enumerate(plan_items):
            if _term_in_step(item, term):
                return index
    for index, item in enumerate(plan_items):
        if any(_term_in_step(item, keyword) for keyword in _STEP_KEYWORDS_BY_KIND.get(kind, ())):
            return index
    return -1


def _bound_name(kind: str, ref: ResourceRef) -> str:
    """How a bound resource is named in its step's "(using ...)" suffix.

    A tool carries its ``provider/tool`` id in ASCII brackets after the label:
    the shared generator pins a tool deterministically only on that identifier
    (``tool_catalogue._find_explicit_tool_keys``), never on the label, and its
    boundary treats '[' / ']' as non-word characters. A model's label already is
    its full id and keeps the label alone.
    """
    return f"{ref.label} [{ref.id}]" if kind == "plugin" else ref.label


# A binder-produced suffix, or several stacked from repeated binds, trailing
# a plan item. Stripped before each bind so a loop-back re-bind reflects only
# the current selection instead of accumulating every past one. A tool's
# "[provider/tool]" id sits inside the parentheses and holds no parenthesis
# itself, so ``[^()]*`` strips it along with the label.
_TRAILING_USING_SUFFIX = re.compile(r"(\s*\(using [^()]*\))+\s*$")


def bind_resources(model, tenant_id: str, plan_items: list[str], resource_ids: list[str]) -> list[str]:
    """Name each selected resource on the plan step it covers.

    Used to append every label to the LAST step -- in the ESQ1-302 session the
    end-node step read "(using langgenius/tokener/tokener/deepseek-v4-flash,
    Code Interpreter)" while the step that needed a tool said nothing. The
    last step is now only the fallback for a resource no step names. A tool
    is named with its id (``_bound_name``) so the generator pins exactly that
    tool.

    A loop-back (build.review / build.reverted -> re-walk resources ->
    approve_plan) feeds the already-bound plan back in here, so every item's
    trailing "(using ...)" suffix is stripped before binding fresh: a
    deselected resource must not keep its old suffix, and a re-bind of the
    same selection must not pile a duplicate on top of it.
    """
    inv = resources.list_tenant_resources(tenant_id)
    kinds: dict[str, str] = {}
    kinds.update({r.id: "plugin" for r in inv.tools})
    kinds.update({r.id: "model" for r in inv.models})
    by_id = {r.id: r for r in (*inv.tools, *inv.models)}
    chosen = [by_id[rid] for rid in resource_ids if rid in by_id]
    stripped = [_TRAILING_USING_SUFFIX.sub("", item) for item in plan_items]
    if not chosen:
        return stripped
    if not plan_items:
        return [f"Use {', '.join(_bound_name(kinds[r.id], r) for r in chosen)}"]
    names_by_step: dict[int, list[str]] = {}
    for ref in chosen:
        index = _covering_step(stripped, kinds[ref.id], ref)
        names_by_step.setdefault(index if index >= 0 else len(stripped) - 1, []).append(_bound_name(kinds[ref.id], ref))
    bound = list(stripped)
    for index, names in names_by_step.items():
        suffix = f" (using {', '.join(names)})"
        if suffix not in bound[index]:
            bound[index] = bound[index] + suffix
    return bound


def learn_from_build(
    model,
    goal_text: str,
    requirements: dict[str, Any],
    plan_items: list[str],
    built_node_ids: list[str],
    on_reasoning: Callable[[str], None] | None = None,
) -> str:
    fallback = f"Reusable skill: a {len(built_node_ids)}-node workflow for: {goal_text[:80]}"
    if model is None:
        return fallback
    system = "Summarize this built workflow as a one-line reusable skill descriptor. Reply with plain text."
    try:
        return (
            llm.invoke_text(
                model,
                system=system,
                user=f"GOAL: {goal_text}\nPLAN: {plan_items}",
                on_reasoning=on_reasoning,
            )
            or fallback
        )
    except Exception:
        return fallback


_ALLOWED_NODE_TYPES: set[str] = set(BUILT_IN_NODE_TYPES)


def _generator_model_config(tenant_id: str, model_config: dict[str, Any]) -> ModelConfig:
    if model_config:
        return ModelConfig.model_validate(
            {
                "provider": model_config.get("provider", ""),
                "name": model_config.get("name", ""),
                "mode": model_config.get("mode", "chat"),
                "completion_params": model_config.get("completion_params", {}),
            }
        )
    inst = resolve_model_instance(tenant_id, None)  # tenant default; read real provider/name off it
    return ModelConfig.model_validate(
        {
            "provider": inst.provider,
            "name": inst.model_name,
            "mode": "chat",
            "completion_params": {},
        }
    )


def _selected_workflow_model(tenant_id: str, resource_ids: Sequence[str]) -> ModelConfig | None:
    """The user-selected MODEL resource (from the resource-confirmation step) as a
    ModelConfig to ground the built workflow's node model blocks, or None when the
    user selected no model.

    A model resource id is ``{provider}/{name}`` (see ``resources._list_models``),
    so split on the last '/'. Only ids that are actually model resources qualify --
    a selected dataset/tool must never ground a node's model. This is deliberately
    separate from the Builder's session/cognition model: the workflow runs on the
    model the user picked, not on whatever model drives the Builder itself.
    """
    if not resource_ids:
        return None
    model_ids = {m.id for m in resources.list_tenant_resources(tenant_id).models}
    selected = next((rid for rid in resource_ids if rid in model_ids), None)
    if selected is None:
        return None
    provider, _, name = selected.rpartition("/")
    if not provider or not name:
        return None
    return ModelConfig.model_validate({"provider": provider, "name": name, "mode": "chat", "completion_params": {}})


# Prepended to the generator instruction so the LLM emits a WORKFLOW-shaped graph
# (start + end node) even when the plan reads like a chatbot. Without this the model
# often produces a chatflow graph (answer node / no end node) that the generator
# rejects as MISSING_TERMINAL -- and the generator does NOT retry that class of
# failure -- so the build silently yields no nodes.
_WORKFLOW_TOPOLOGY_DIRECTIVE = (
    "Build a Dify WORKFLOW graph (this is NOT a chat app): it MUST begin with exactly one "
    "'start' node and terminate in at least one 'end' node that returns the result. Do NOT use "
    "'answer' nodes -- those exist only in chat / advanced-chat apps and are invalid in a workflow."
    "\n\n"
    # Node-usage guidance (meeting item 9). Builder-only: this string is
    # prepended to the instruction at build.py:377 and cmd+K never sees it.
    # Only rules that earned their place by breaking a real build belong here --
    # every line costs planner output budget, which ESQ1-300 implicates.
    "Node usage rules:\n"
    "- A node may only reference variables its upstream node actually declares. A 'tool' node "
    "exposes 'text', 'files' and 'json' (plus whatever its provider declares) -- it does NOT "
    "expose 'result'. A 'code' node exposes exactly the keys in its own outputs map.\n"
    "- 'document-extractor' requires a 'file' or 'file-list' input variable on the start node; "
    "feed its 'text' output into the node that consumes it.\n"
    "- Children of an 'iteration' or 'loop' belong INSIDE the container via their parent "
    "reference. Do not wire a container's body as sibling top-level nodes.\n"
    "- Compare like with like in 'if-else': a numeric variable needs a numeric operator, a "
    "string variable a string operator.\n"
    "- Prefer a 'tool' node whenever an installed tool covers the step (the installed tools are "
    "listed for you). 'http-request' is only for an endpoint the user actually supplied: never "
    "invent one and never use a placeholder such as example.com -- when no real URL is known, read "
    "it from a start-node variable. Expose an http-request's changing inputs as start-node "
    "variables rather than hardcoding them."
)

# Total generation attempts build_nodes will make for one build: the first
# attempt plus at most two corrective retries, stopping at the first success.
_MAX_GENERATION_ATTEMPTS = 3


# Guidance for UNRESOLVED_REFERENCE, named in the generator's own vocabulary (see
# FINDINGS.md Blocker B): each node's config is generated by an isolated LLM call
# that never sees the producer's chosen output names, so a consumer invents a
# reference no producer declares. Keyed on the error CODE, never on message
# wording -- no control flow branches on LLM prose.
_UNRESOLVED_REFERENCE_GUIDANCE = (
    "For every UNRESOLVED_REFERENCE error above, the reference is invalid because no node "
    "declares that exact output name. Fix it one of two ways: (1) make the PRODUCING node "
    "declare that exact name -- a 'code' node's 'outputs' map, a 'parameter-extractor' node's "
    "'parameters[].name', or an 'llm' node's structured-output schema -- or (2) change the "
    "consumer to reference one of the producer's REAL outputs (an 'llm' node with no "
    "structured output exposes only 'text'). Never invent an output name that matches neither."
)


def _valid_errors(result: dict[str, Any]) -> list[dict[str, Any]]:
    """The generator's structured ``errors`` list, filtered to well-formed dict
    entries -- shared by every reader of ``result["errors"]`` (the retry
    instruction, the error-card text, and the debug-log diagnostic) so a
    malformed/degraded entry can't be treated as one three separate ways."""
    errors = result.get("errors")
    return [e for e in errors if isinstance(e, dict)] if isinstance(errors, list) else []


def _format_generator_error(error: dict[str, Any]) -> str:
    """One line for a structured generator error: its code, detail, and (when
    present) the offending node id -- so both the retry instruction and the
    error card name WHERE to fix it, not just what went wrong."""
    code = str(error.get("code") or "").strip()
    detail = str(error.get("detail") or error.get("message") or "").strip()
    node_id = error.get("node_id")
    node_part = f" (node {node_id!r})" if node_id else ""
    label = f"{code}: {detail}" if code else detail
    return f"- {label}{node_part}"


def _terminal_retry_instruction(base_instruction: str, result: dict[str, Any]) -> str:
    """Corrective instruction for a generation retry after a validation failure --
    feeds back EVERY structured error (``result["errors"]``: code, detail, node id)
    rather than only the first, adds UNRESOLVED_REFERENCE-specific guidance when
    that code is present, and keeps the topology guidance the retry has always
    carried (start/end/answer) regardless of which error(s) triggered the retry."""
    errors = _valid_errors(result)
    if errors:
        error_text = "\n".join(_format_generator_error(e) for e in errors)
    else:
        error_text = str(result.get("error") or "").strip() or "the generated graph had no nodes"

    guidance = ""
    if any(str(e.get("code")) == "UNRESOLVED_REFERENCE" for e in errors):
        guidance = f"\n\n{_UNRESOLVED_REFERENCE_GUIDANCE}"

    return (
        f"Your previous attempt was rejected:\n{error_text}{guidance}\n\n"
        "Regenerate the COMPLETE workflow graph with exactly one 'start' node and at least one "
        "'end' node wired from the final step. Do NOT use 'answer' nodes.\n\n"
        f"{base_instruction}"
    )


def _generation_error_text(result: dict[str, Any]) -> str:
    """Best human-readable failure reason from a generator result -- EVERY
    structured ``errors`` entry rendered (via ``_format_generator_error``, so the
    card names the offending node the same way the retry instruction does) and
    joined (so a multi-error failure isn't truncated to the first), else the
    top-level ``error`` string, else a generic fallback. Surfaced to the user so
    a failed build shows WHY -- and WHERE -- not a hardcoded 'couldn't build'
    message.

    Joined with a NEWLINE, like the retry instruction: ``_format_generator_error``
    already prefixes each line with ``- ``, so joining with ``"; "`` rendered a
    two-error failure as the run-on ``- X (node 'h'); - Y``."""
    errors = _valid_errors(result)
    if errors:
        return "\n".join(_format_generator_error(e) for e in errors)
    err = result.get("error")
    if isinstance(err, str) and err.strip():
        return err.strip()
    return "the generator returned no usable graph"


def _diagnostic(**fields: Any) -> dict[str, Any]:
    """One debug-log breadcrumb, stamped with the server's UTC time.

    ``at`` is the correlation key: pod logs are lost on restart, but the exported
    debug log keeps this timestamp so the surviving log window can be searched
    around it (and matched to the same failure the server logged).
    """
    return {"at": datetime.now(UTC).isoformat(), **fields}


def _generation_diagnostic(result: dict[str, Any], *, attempt: int) -> dict[str, Any]:
    """Capture one failed generation attempt: the generator's structured errors
    (``code`` / ``detail`` / ``node_id`` -- e.g. UNRESOLVED_REFERENCE on node2),
    which is strictly more than the server-side log line carries."""
    errors = _valid_errors(result)
    return _diagnostic(
        source="workflow-generator",
        attempt=attempt,
        message=_generation_error_text(result),
        codes=[str(e.get("code")) for e in errors if e.get("code")],
        errors=errors,
    )


def _prepare_build_candidate(
    graph: dict[str, Any],
    grounding_mc: ModelConfig,
    trusted_text: str,
) -> preflight.VettedIntents:
    """Translate, ground, and vet the complete candidate as the write guard does.

    Grounding precedes validation: the runtime model, selected resources, and
    user-supplied endpoint/credential inputs are the configuration we will
    actually persist. A refusal condemns the entire generated batch; the
    caller must correct it rather than returning only the applicable subset.
    """
    intents = graph_translate.to_intents(graph)
    _ground(intents, grounding_mc)
    for node_id in _ground_placeholder_endpoints(intents, trusted_text=trusted_text):
        logger.info("Dify Builder: http-request %s had a placeholder URL; now read from a start variable", node_id)
    for node_id in _ground_placeholder_credentials(intents, trusted_text=trusted_text):
        logger.info(
            "Dify Builder: http-request %s had a placeholder credential; now read from a start variable", node_id
        )
    return preflight.vet_intents({"nodes": [], "edges": []}, intents, _ALLOWED_NODE_TYPES)


def build_nodes(
    tenant_id: str,
    model_config: dict[str, Any],
    plan_items: list[str],
    resource_ids: Sequence[str] = (),
    *,
    trusted_text: str = "",
) -> BuildNodesResult:
    diagnostics: list[dict[str, Any]] = []
    try:
        mc = _generator_model_config(tenant_id, model_config)
        base_instruction = f"{_WORKFLOW_TOPOLOGY_DIRECTIVE}\n\nAPPROVED PLAN:\n" + "\n".join(plan_items)
        if trusted_text:
            base_instruction += (
                "\n\nORIGINAL USER REQUEST AND CONFIRMED REQUIREMENTS (authoritative):\n"
                f"{trusted_text}\n\n"
                "Preserve every explicit constraint in this original source, including fixed numeric limits. "
                "If the plan omits or conflicts with a source constraint, follow the original source. "
                "Do not replace a fixed maximum with an invented optional input."
            )

        def _generate(instruction: str) -> dict[str, Any]:
            return WorkflowGeneratorService.generate_workflow_graph(
                tenant_id=tenant_id,
                mode="workflow",
                instruction=instruction,
                model_config=mc,
                current_graph=None,
            )

        instruction = base_instruction
        grounding_mc: ModelConfig | None = None
        for attempt in range(1, _MAX_GENERATION_ATTEMPTS + 1):
            result = _generate(instruction)
            graph = result.get("graph") or {}
            source = "workflow-generator"
            if not result.get("error") and graph.get("nodes"):
                # Generation uses the cognition model; the complete runtime graph
                # follows the user's selected model, or the session fallback.
                if grounding_mc is None:
                    grounding_mc = _selected_workflow_model(tenant_id, resource_ids) or mc
                candidate = _prepare_build_candidate(graph, grounding_mc, trusted_text)
                if not candidate.rejections and candidate.applicable:
                    return BuildNodesResult(intents=candidate.applicable, diagnostics=diagnostics)
                # vet_intents supplies credential-safe node/field refusals from
                # the real engine. Never embed the raw candidate config here.
                source = "build_nodes"
                result = {
                    "error": "the generated graph had no applicable node intents",
                    "errors": [{"code": "CANDIDATE_VALIDATION", "detail": reason} for reason in candidate.rejections],
                }

            diagnostic = _generation_diagnostic(result, attempt=attempt)
            diagnostic["source"] = source
            diagnostics.append(diagnostic)
            if attempt < _MAX_GENERATION_ATTEMPTS:
                instruction = _terminal_retry_instruction(base_instruction, result)

        error = _generation_error_text(result)
        logger.warning(
            "Dify Builder: build_nodes produced no graph for tenant %s (%d plan items) after %d attempt(s): error=%s",
            tenant_id,
            len(plan_items),
            _MAX_GENERATION_ATTEMPTS,
            error,
        )
        return BuildNodesResult(intents=[], error=error, diagnostics=diagnostics)
    except Exception as exc:  # any generation/translation failure -> honest empty build
        logger.exception(
            "Dify Builder: build_nodes generation failed for tenant %s (%d plan items); returning empty build",
            tenant_id,
            len(plan_items),
        )
        # Surface the exception text (e.g. a provider error like credit_balance_exhausted)
        # so the user sees WHY, not a hardcoded 'couldn't build' message.
        message = str(exc).strip() or type(exc).__name__
        diagnostics.append(_diagnostic(source="build_nodes", message=message, exception=type(exc).__name__))
        return BuildNodesResult(intents=[], error=message, diagnostics=diagnostics)


# Hosts / tokens an LLM writes when it does not know the real endpoint. A Dify
# template (``{{#node.var#}}``) is a real reference and is NOT a placeholder;
# a bare ``{tenant}`` or ``<your-domain>`` is. ``localhost`` is deliberately NOT
# here -- it names the *host*, not any substring, so it is checked separately
# against the parsed hostname (see ``_is_localhost_host``): a real tunnel host
# like ``abc123.localhost.run`` must not match just because "localhost" is a
# substring of it.
_PLACEHOLDER_URL_RE = re.compile(
    r"(^|[./-])example\.(com|org|net)\b"  # api.example.com, example.org
    r"|your[-_]?(api|domain|server|host|company)"  # your-api.com
    r"|placeholder"
    r"|<[^>]+>"  # <your-domain>
    r"|(?<!\{)\{(?!\{)[^{}#]*\}(?!\})",  # {tenant}, but not {{#s.x#}}
    re.IGNORECASE,
)


def _is_localhost_host(url: str) -> bool:
    """True when the URL's HOST -- not merely a substring of the URL -- is
    ``localhost`` or a ``*.localhost`` name, ignoring any port. A hostname
    like ``abc123.localhost.run`` is a real, routable tunnel domain (the
    reserved ``.localhost`` TLD requires it to be the final label) and must
    not match."""
    try:
        host = urlsplit(url).hostname
    except ValueError:
        return False
    return host is not None and (host == "localhost" or host.endswith(".localhost"))


def _is_placeholder_endpoint(url: str) -> bool:
    """True for a URL the model invented rather than one the user supplied."""
    text = (url or "").strip()
    if not text:
        return True
    return _PLACEHOLDER_URL_RE.search(text) is not None or _is_localhost_host(text)


def _add_required_start_variable(variables: list[dict], var_name: str, label: str) -> None:
    """Append a REQUIRED text-input start variable (max 2048 chars) named
    ``var_name`` to ``variables`` if not already present -- the write shared
    by every grounding pass that turns an invented literal (URL, credential)
    into a start-node input, so it is not duplicated per pass."""
    if any(isinstance(v, dict) and v.get("variable") == var_name for v in variables):
        return
    variables.append(
        {
            "variable": var_name,
            "label": label,
            "type": "text-input",
            "required": True,
            "max_length": 2048,
        }
    )


def _ground_placeholder_endpoints(intents: list[MutationIntent], *, trusted_text: str = "") -> list[str]:
    """Replace every http-request URL the user didn't supply with a REQUIRED
    start-node variable and a template reference to it.

    ESQ1-302 called ``https://api.example.com/ppt/generate``: the model had no
    endpoint, so it invented one, and every test run failed against a host that
    does not exist. Turning the URL into an input makes the test-data gate ask
    the user for the real endpoint -- or, when they have none, tells them what
    the step needs. Builder-only; the shared generator's own http-request
    example is ``https://example.com``, so cmd+K keeps its placeholders.

    A URL is grounded when it LOOKS invented (``_is_placeholder_endpoint``) OR,
    with ``trusted_text`` non-empty, when its host never actually appears in
    what the user typed (``user_supplied.is_user_supplied_url``) -- a
    plausible, real-looking host the model invented (S5b:
    ``api.pptrender.io``) is just as much a fabrication as
    ``api.example.com``, only harder to spot by shape alone.
    ``trusted_text == ""`` (no caller-supplied text) keeps exactly today's
    placeholder-only behaviour.

    A URL whose HOST is already a template (``urls.host_is_templated``) reads
    its endpoint from a variable and is never re-grounded, which also makes a
    second pass a no-op. A URL with templates only in its path/query (e.g.
    ``https://api.pptrender.io/v1/render?topic={{#node1.topic#}}``) has only
    its ``scheme://host[:port]`` replaced -- the path, the query and the data
    templates in them are kept verbatim, and the start variable is labelled
    "<title> base URL". A URL with no templates is replaced whole ("<title>
    URL"), as is one with no ``scheme://`` to split at. Returns the ids of the
    http-request nodes it re-pointed.
    """
    start = next((i for i in intents if i.op == "create_node" and i.args.get("node_type") == "start"), None)
    if start is None:
        return []
    start_id = str(start.args.get("node_id") or "")
    if not start_id:
        return []
    config = dict(start.args.get("config") or {})
    variables = list(config.get("variables") or [])
    grounded: list[str] = []
    for intent in intents:
        if intent.op != "create_node" or intent.args.get("node_type") != "http-request":
            continue
        node_config = dict(intent.args.get("config") or {})
        url = str(node_config.get("url") or "")
        if urls.host_is_templated(url):
            continue
        not_user_supplied = bool(trusted_text) and not user_supplied.is_user_supplied_url(url, trusted_text)
        if not (_is_placeholder_endpoint(url) or not_user_supplied):
            continue
        node_id = str(intent.args.get("node_id") or "")
        var_name = f"{node_id}_url"
        template_ref = f"{{{{#{start_id}.{var_name}#}}}}"
        title = node_config.get("title") or node_id
        parts = urls.split_origin(url)
        if parts is not None and urls.TEMPLATE_MARKER in parts.rest:
            _add_required_start_variable(variables, var_name, f"{title} base URL")
            node_config["url"] = f"{template_ref}{parts.rest}"
        else:
            _add_required_start_variable(variables, var_name, f"{title} URL")
            node_config["url"] = template_ref
        intent.args["config"] = node_config
        grounded.append(node_id)
    if grounded:
        config["variables"] = variables
        start.args["config"] = config
    return grounded


# A value that IS one of these words and nothing else (no content after it)
# is a bare auth-scheme with no credential attached -- ``strip_auth_scheme``
# alone does not catch this: its regex only strips a scheme word FOLLOWED BY
# whitespace, so a bare "Bearer" (nothing after it) comes back unstripped,
# not empty.
_BARE_SCHEME_WORDS = frozenset({"bearer", "basic", "token"})

# The only keys whose value is ``<scheme> <credentials>``, so the only ones on
# which a bare scheme word is kept when grounding (``_replace_credential_value``).
_AUTHORIZATION_KEYS = frozenset({"authorization", "proxy-authorization"})

# Mirrors user_supplied._TEMPLATE_MARKER: a Dify template reference names a
# variable, not a literal, so it is never "invented" and must never be
# re-grounded -- checked BEFORE the placeholder-shape check below, since a
# grounded variable's own NAME (e.g. "your_api_key") can coincidentally match
# CREDENTIAL_PLACEHOLDER_RE's "YOUR...KEY" pattern.
_TEMPLATE_MARKER = "{{#"


def _is_invented_credential(value: str, trusted_text: str) -> bool:
    """Mirrors ``_ground_placeholder_endpoints``'s OR-of-two-checks shape, but
    for a credential value (a header/param 'Value' half, or an
    ``authorization.config.api_key``):

    1. Already a Dify template reference (contains ``{{#``) -- a real
       reference, never re-grounded, checked first (see ``_TEMPLATE_MARKER``).
    2. Empty, or nothing beyond a bare ``Bearer``/``Basic``/``Token`` scheme
       word -- never a valid credential either way, so it grounds
       unconditionally.
    3. An unmistakable placeholder (``CREDENTIAL_PLACEHOLDER_RE``) -- grounds
       even in placeholder-only mode (``trusted_text == ""``, mirroring how a
       shaped-like-invented URL grounds with no goal text at all).
    4. Otherwise, with ``trusted_text`` non-empty, a value that never appears
       verbatim in it also grounds (S5b-style plausible-looking secret the
       model invented).
    """
    stripped_value = value.strip()
    remainder = user_supplied.strip_auth_scheme(stripped_value)
    if _TEMPLATE_MARKER in remainder:
        return False
    if not remainder or remainder.lower() in _BARE_SCHEME_WORDS:
        return True
    if user_supplied.CREDENTIAL_PLACEHOLDER_RE.search(remainder):
        return True
    return bool(trusted_text) and not user_supplied.is_user_supplied_secret(stripped_value, trusted_text)


def _replace_credential_value(value: str, template_ref: str, *, keep_bare_scheme: bool) -> str:
    """Rebuild a header/param 'Value' half with its secret swapped for
    ``template_ref``, preserving surrounding whitespace (including a ``\\r``
    left by a ``\\r\\n`` line ending) and a leading ``Bearer ``/``Basic ``/
    ``Token `` auth-scheme prefix exactly as written (e.g. ``" Bearer
    YOUR_API_KEY"`` -> ``" Bearer {{#s.h_api_key#}}"``).

    A BARE scheme word with nothing after it (``"Bearer"``) is an auth scheme
    only on an ``Authorization``/``Proxy-Authorization`` line
    (``keep_bare_scheme``): there it keeps the word, adding the separating
    space the grounded value now needs. Under any other credential key
    (``X-Auth-Token: token``, ``api_key: token``) the word IS the invented
    value, so it is replaced whole."""
    lstripped = value.lstrip(" \t\r")
    leading_ws = value[: len(value) - len(lstripped)]
    core = lstripped.rstrip(" \t\r")
    trailing_ws = lstripped[len(core) :]
    remainder = user_supplied.strip_auth_scheme(core)
    if remainder == core and core.lower() in _BARE_SCHEME_WORDS:
        scheme_prefix = f"{core} " if keep_bare_scheme else ""
    else:
        scheme_prefix = core[: len(core) - len(remainder)]
    return f"{leading_ws}{scheme_prefix}{template_ref}{trailing_ws}"


def _ground_credential_text(text: str, template_ref: str, *, trusted_text: str, key_is_credential) -> tuple[str, bool]:
    """Ground each ``Key: Value`` line of an http-request ``headers``/
    ``params`` text block whose key names a credential per
    ``key_is_credential`` (``user_supplied.is_credential_key`` for headers;
    ``user_supplied.is_credential_param_key`` for params, which also treats a
    bare ``key`` as one) and whose value the user didn't supply
    (``_is_invented_credential``), replacing only the secret part of that
    line with ``template_ref``. Every other line -- including a credential
    line the user DID supply -- passes through byte-identical. Returns
    ``(new_text, changed)``.
    """
    if not text:
        return text, False
    lines = text.split("\n")
    changed = False
    new_lines: list[str] = []
    for line in lines:
        if ":" not in line:
            new_lines.append(line)
            continue
        key, _sep, value = line.partition(":")
        if not key_is_credential(key.strip()) or not _is_invented_credential(value, trusted_text):
            new_lines.append(line)
            continue
        keep_bare_scheme = key.strip().lower() in _AUTHORIZATION_KEYS
        new_lines.append(f"{key}:{_replace_credential_value(value, template_ref, keep_bare_scheme=keep_bare_scheme)}")
        changed = True
    return "\n".join(new_lines), changed


def _ground_placeholder_credentials(intents: list[MutationIntent], *, trusted_text: str = "") -> list[str]:
    """Replace every http-request credential literal the user didn't supply
    -- a header/param whose key names a credential, or an ``api-key``
    authorization's ``config.api_key`` -- with a REQUIRED start-node variable
    and a template reference to it. Sibling to ``_ground_placeholder_endpoints``,
    called right after it in ``build_nodes`` and sharing its start-variable
    insertion write (``_add_required_start_variable``); reads the start
    node's config fresh, so a variable that pass already added (e.g.
    ``<node>_url``) is seen and not clobbered.

    S5b/F2: requirements analysis invented an ``Authorization: Bearer
    YOUR_API_KEY`` header for a goal that named no credential. Turning it
    into an input makes the test-data gate ask the user for the real key --
    or, when mocked, drop it (``without_endpoint_values`` -> now
    ``endpoint_variable_names``, extended to also scan headers/params/
    authorization) so the run fails on a missing required input instead of
    an invented secret the target API rejects.

    A single ``<node>_api_key`` variable covers every credential grounded on
    that node, however many lines/fields triggered it. Returns the ids of the
    http-request nodes it re-pointed.
    """
    start = next((i for i in intents if i.op == "create_node" and i.args.get("node_type") == "start"), None)
    if start is None:
        return []
    start_id = str(start.args.get("node_id") or "")
    if not start_id:
        return []
    config = dict(start.args.get("config") or {})
    variables = list(config.get("variables") or [])
    grounded: list[str] = []
    for intent in intents:
        if intent.op != "create_node" or intent.args.get("node_type") != "http-request":
            continue
        node_config = dict(intent.args.get("config") or {})
        node_id = str(intent.args.get("node_id") or "")
        var_name = f"{node_id}_api_key"
        template_ref = f"{{{{#{start_id}.{var_name}#}}}}"
        changed = False

        new_headers, headers_changed = _ground_credential_text(
            str(node_config.get("headers") or ""),
            template_ref,
            trusted_text=trusted_text,
            key_is_credential=user_supplied.is_credential_key,
        )
        if headers_changed:
            node_config["headers"] = new_headers
            changed = True

        new_params, params_changed = _ground_credential_text(
            str(node_config.get("params") or ""),
            template_ref,
            trusted_text=trusted_text,
            key_is_credential=user_supplied.is_credential_param_key,
        )
        if params_changed:
            node_config["params"] = new_params
            changed = True

        authorization = node_config.get("authorization")
        auth_config = authorization.get("config") if isinstance(authorization, dict) else None
        if (
            isinstance(authorization, dict)
            and authorization.get("type") == "api-key"
            and isinstance(auth_config, dict)
            and _is_invented_credential(str(auth_config.get("api_key") or ""), trusted_text)
        ):
            new_auth_config = dict(auth_config)
            new_auth_config["api_key"] = template_ref
            node_config["authorization"] = {**authorization, "config": new_auth_config}
            changed = True

        if not changed:
            continue
        _add_required_start_variable(variables, var_name, f"{node_config.get('title') or node_id} API key")
        intent.args["config"] = node_config
        grounded.append(node_id)
    if grounded:
        config["variables"] = variables
        start.args["config"] = config
    return grounded


def _ground(intents: list[MutationIntent], mc: ModelConfig) -> None:
    mode = mc.mode.value if hasattr(mc.mode, "value") else str(mc.mode)
    for intent in intents:
        if intent.op != "create_node":
            continue
        config = intent.args.get("config") or {}
        if isinstance(config.get("model"), dict):
            # Ground ONLY provider+name (the real, configured model); preserve whatever
            # mode/completion_params the generator produced -- never fabricate params.
            # Applies to ANY node type that carries a model block (llm,
            # question-classifier, parameter-extractor, ...), not just "llm" --
            # otherwise a drifted/hallucinated model on those node types flows
            # through ungrounded.
            model = dict(config["model"])
            model["provider"] = mc.provider
            model["name"] = mc.name
            model.setdefault("mode", mode)
            config["model"] = model
        intent.args["config"] = config
