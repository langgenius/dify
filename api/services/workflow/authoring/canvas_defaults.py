"""What the web canvas gives a new node of each block type, and the fields a node of that type must not leave empty.

The values are generated from the web's `default.ts` files (web/scripts/generate-node-defaults.ts). The purpose
locs are written by hand from each node's `checkValid`, which is code with translated text and cannot be generated.
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from importlib import resources
from typing import Final, Self

from pydantic import TypeAdapter

from core.trigger.constants import TRIGGER_SCHEDULE_NODE_TYPE, TRIGGER_WEBHOOK_NODE_TYPE
from core.workflow.llm_environment_variable import parse_llm_model_selector, should_resolve_llm_model_selector
from graphon.enums import BuiltinNodeTypes
from graphon.model_runtime.entities.llm_entities import LLMMode
from services.knowledge_fs.knowledge_retrieval_v2.entities import KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE

type Loc = tuple[str | int, ...]
type EmptyLocs = Callable[[Mapping[str, object], Loc], list[Loc]]

WILDCARD: Final = "*"
_TYPE_KEY: Final = "type"
_VERSION_KEY: Final = "version"
_JINJA2_EDITION: Final = "jinja2"
_TEXT_KEY: Final = "text"
_JINJA2_TEXT_KEY: Final = "jinja2_text"
_HUMAN_INPUT_V2_ENTRY: Final = "human-input-v2"
_START_NODE_ID_KEY: Final = "start_node_id"
_ITERATOR_SELECTOR_KEY: Final = "iterator_selector"
_OUTPUT_SELECTOR_KEY: Final = "output_selector"
_DELIVERY_METHODS_KEY: Final = "delivery_methods"
_MODEL_SELECTOR_KEY: Final = "model_selector"
_VARIABLES_KEY: Final = "variables"
_ADVANCED_SETTINGS_KEY: Final = "advanced_settings"
_GROUP_ENABLED_KEY: Final = "group_enabled"
_GROUPS_KEY: Final = "groups"
_GROUP_LOCS: Final[tuple[Loc, ...]] = (
    (_ADVANCED_SETTINGS_KEY, _GROUPS_KEY),
    (_ADVANCED_SETTINGS_KEY, _GROUPS_KEY, WILDCARD, _VARIABLES_KEY, WILDCARD),
)
_DEFAULTS_FILE: Final = "canvas_defaults.json"
_DEFAULTS: Final = TypeAdapter(dict[str, dict[str, object]]).validate_json(
    resources.files(__package__).joinpath(_DEFAULTS_FILE).read_text(encoding="utf-8")
)


def _nothing_withheld(_written: Mapping[str, object]) -> frozenset[str]:
    return frozenset()


def _start_child_is_written_by_the_agent(_written: Mapping[str, object]) -> frozenset[str]:
    """A container's start child is a node id; the canvas's empty id is no default, and it hides the missing child."""
    return frozenset({_START_NODE_ID_KEY})


def _iteration_references_are_written_by_the_agent(written: Mapping[str, object]) -> frozenset[str]:
    """Like the start child, the selectors an iteration reads and writes have no default; the canvas's empty ones make
    the node unreadable to check.
    """
    return _start_child_is_written_by_the_agent(written) | {_ITERATOR_SELECTOR_KEY, _OUTPUT_SELECTOR_KEY}


def _completion_model_has_no_chat_prompt(written: Mapping[str, object]) -> frozenset[str]:
    """The canvas prompt is a chat message list; a node written for a completion model needs a text prompt."""
    model = written.get("model")
    if isinstance(model, Mapping) and model.get("mode") == LLMMode.COMPLETION:
        return frozenset({"prompt_template"})
    return frozenset()


def _is_empty(value: object) -> bool:
    """Missing, None, blank text, or a list or dict with nothing in it; a reference such as `{{#x.y#}}` is text."""
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (Mapping, Sequence)):
        return len(value) == 0
    return False


def _message_has_text(message: object) -> bool:
    if not isinstance(message, Mapping):
        return False
    text_key = _JINJA2_TEXT_KEY if message.get("edition_type") == _JINJA2_EDITION else _TEXT_KEY
    return not _is_empty(message.get(text_key))


def _llm_prompt_is_empty(written: Mapping[str, object]) -> bool:
    """A chat prompt is a list of messages and a completion prompt is one message; either is empty when no message has
    text. A node with memory is not asked for a prompt.
    """
    if written.get("memory") is not None:
        return False
    prompt = written.get("prompt_template")
    messages = prompt if isinstance(prompt, list) else [prompt]
    return not any(_message_has_text(message) for message in messages)


def _empty_purpose(written: Mapping[str, object], loc: Loc) -> list[Loc]:
    """The generic rule: the places `loc` names in the node that are empty."""
    return _empty_locs(written, loc, ())


def _empty_llm_prompt(written: Mapping[str, object], loc: Loc) -> list[Loc]:
    return [loc] if _llm_prompt_is_empty(written) else []


def _names_an_environment_model(selector: object) -> bool:
    try:
        parse_llm_model_selector(selector)
    except ValueError:
        return False
    return True


def _empty_llm_model(written: Mapping[str, object], loc: Loc) -> list[Loc]:
    """A selector meant for an environment model (llm/utils.ts isEnvironmentModelSource) replaces the written model:
    it passes when it names one, and asks for the model whatever is written when it doesn't (llm/default.ts:92-99).
    """
    selector = written.get(_MODEL_SELECTOR_KEY)
    if not should_resolve_llm_model_selector(selector):
        return _empty_purpose(written, loc)
    if _names_an_environment_model(selector):
        return []
    return [loc]


def _groups_enabled(written: Mapping[str, object]) -> bool:
    settings = written.get(_ADVANCED_SETTINGS_KEY)
    if not isinstance(settings, Mapping):
        return False
    return bool(settings.get(_GROUP_ENABLED_KEY))


def _empty_variables_or_groups(written: Mapping[str, object], loc: Loc) -> list[Loc]:
    """A grouped aggregator is asked for groups and for each variable in them, not for its own variables; a group with
    no variables passes, as on the web.
    """
    if not _groups_enabled(written):
        return _empty_purpose(written, loc)
    return [found for group_loc in _GROUP_LOCS for found in _empty_purpose(written, group_loc)]


def _empty_ungrouped_variable(written: Mapping[str, object], loc: Loc) -> list[Loc]:
    if _groups_enabled(written):
        return []
    return _empty_purpose(written, loc)


@dataclass(frozen=True)
class CanvasEdition:
    """What the canvas gives a node of one version of a block type, from the web entry `entry`.

    `withheld` names the canvas keys not to write for the node as written, because the canvas value would not suit it.
    `emptiness` holds the purpose locs whose emptiness is not the generic rule's, each with its own finder of the
    empty locs it names in the node.
    `untaken` names the keys the editor's empty containers give every node of the type but this version does not
    take; fill leaves them out, while import and the draft hash keep them.
    """

    version: str | None
    entry: str
    purpose: tuple[Loc, ...]
    withheld: Callable[[Mapping[str, object]], frozenset[str]] = _nothing_withheld
    emptiness: Mapping[Loc, EmptyLocs] = field(default_factory=dict)
    untaken: frozenset[str] = frozenset()

    @property
    def data(self) -> Mapping[str, object]:
        return _DEFAULTS.get(self.entry, {})


class CanvasNode(StrEnum):
    """A block type the canvas adds. `data` is what the canvas gives a new node of it, as generated from the web.

    `purpose` lists the fields the web's `checkValid` rejects when empty, each as the path to it; `*` stands for
    each item of a list. Conditions that depend on other fields (an operator that takes no value, a mode) are not
    listed.

    A member is given either the purpose locs of its one edition, or one `CanvasEdition` per version when the versions
    differ or an edition has hooks. `data` and `purpose` are those of the first edition, which is the version a node
    without one has. `edition` picks by a node's version.
    """

    data: Mapping[str, object]
    purpose: tuple[Loc, ...]
    editions: Mapping[str | None, CanvasEdition]

    def __new__(cls, value: str, *parts: Loc | CanvasEdition) -> Self:
        member = str.__new__(cls, value)
        member._value_ = value
        locs = [part for part in parts if not isinstance(part, CanvasEdition)]
        editions = [part for part in parts if isinstance(part, CanvasEdition)]
        if locs and editions:
            raise TypeError(f"{value}: purpose locs and editions cannot be mixed")
        if not editions:
            editions = [CanvasEdition(None, value, tuple(locs))]
        member.editions = {edition.version: edition for edition in editions}
        member.data = editions[0].data
        member.purpose = editions[0].purpose
        return member

    def edition(self, version: object = None) -> CanvasEdition | None:
        """The edition for a node's version; None when this type has editions and the version is not one of them."""
        if None in self.editions:
            return self.editions[None]
        key = next(iter(self.editions)) if version is None else version
        if not isinstance(key, str):
            return None
        return self.editions.get(key)

    # answer/default.ts:21
    ANSWER = (BuiltinNodeTypes.ANSWER, ("answer",))
    # assigner/default.ts:28; the value is required only for some operations (:34-58)
    ASSIGNER = (BuiltinNodeTypes.VARIABLE_ASSIGNER, ("items", WILDCARD, "variable_selector"))
    # code/default.ts:27, 32, 37
    CODE = (
        BuiltinNodeTypes.CODE,
        ("code",),
        ("variables", WILDCARD, "variable"),
        ("variables", WILDCARD, "value_selector"),
    )
    # document-extractor/default.ts:26
    DOCUMENT_EXTRACTOR = (BuiltinNodeTypes.DOCUMENT_EXTRACTOR, ("variable_selector",))
    # end/default.ts:22, 28-32
    END = (
        BuiltinNodeTypes.END,
        ("outputs",),
        ("outputs", WILDCARD, "variable"),
        ("outputs", WILDCARD, "value_selector"),
    )
    # http/default.ts:45; the binary body file is required only for a binary body (:51-56)
    HTTP_REQUEST = (BuiltinNodeTypes.HTTP_REQUEST, ("url",))
    HUMAN_INPUT = (
        BuiltinNodeTypes.HUMAN_INPUT,
        # human-input/default.ts:53 and shared/default-utils.ts:23-35
        CanvasEdition(
            "1",
            BuiltinNodeTypes.HUMAN_INPUT,
            (
                ("delivery_methods",),
                ("user_actions",),
                ("user_actions", WILDCARD, "id"),
                ("user_actions", WILDCARD, "title"),
            ),
        ),
        # human-input-v2/default.ts:51, 72, 74 and shared/default-utils.ts:23-35; the checks on a recipient (:53) and on
        # the request URL in the body (:76-79) are not listed
        CanvasEdition(
            "2",
            _HUMAN_INPUT_V2_ENTRY,
            (
                ("recipients_spec",),
                ("message_template", "subject"),
                ("message_template", "body"),
                ("user_actions",),
                ("user_actions", WILDCARD, "id"),
                ("user_actions", WILDCARD, "title"),
            ),
            untaken=frozenset({_DELIVERY_METHODS_KEY}),
        ),
    )
    # if-else/default.ts:43, 47, 56, 62; the value is required only for some operators (:84-89)
    IF_ELSE = (
        BuiltinNodeTypes.IF_ELSE,
        ("cases",),
        ("cases", WILDCARD, "conditions"),
        ("cases", WILDCARD, "conditions", WILDCARD, "variable_selector"),
        ("cases", WILDCARD, "conditions", WILDCARD, "comparison_operator"),
    )
    # iteration/default.ts:32, 39; the canvas sets start_node_id itself, and a run fails without it
    ITERATION = (
        BuiltinNodeTypes.ITERATION,
        CanvasEdition(
            None,
            BuiltinNodeTypes.ITERATION,
            ((_ITERATOR_SELECTOR_KEY,), (_OUTPUT_SELECTOR_KEY,), (_START_NODE_ID_KEY,)),
            withheld=_iteration_references_are_written_by_the_agent,
        ),
    )
    # knowledge-retrieval/default.ts:35; the model is required only for single retrieval (:41-45)
    KNOWLEDGE_RETRIEVAL = (BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, ("dataset_ids",))
    # knowledge-retrieval-v2/default.ts:31; the text or the image query is enough (:27)
    KNOWLEDGE_RETRIEVAL_V2 = (KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE, ("control_space_ids",))
    # list-operator/default.ts:43; the filter condition is required only when the filter is on (:50-75)
    LIST_OPERATOR = (BuiltinNodeTypes.LIST_OPERATOR, ("variable",))
    LLM = (
        BuiltinNodeTypes.LLM,
        # llm/default.ts:92-99 (provider; an empty name means no model is chosen yet; a model an `env` selector names
        # comes from that variable, :77-90), 101-117 (a prompt is empty when every message's text is "", and is not
        # checked with memory); a prompt for a completion model is not the canvas's chat list (:103-111)
        CanvasEdition(
            None,
            BuiltinNodeTypes.LLM,
            (("model", "provider"), ("model", "name"), ("prompt_template",)),
            withheld=_completion_model_has_no_chat_prompt,
            emptiness={
                ("model", "provider"): _empty_llm_model,
                ("model", "name"): _empty_llm_model,
                ("prompt_template",): _empty_llm_prompt,
            },
        ),
    )
    # loop/default.ts:36, 51, 57; start_node_id as for iteration
    LOOP = (
        BuiltinNodeTypes.LOOP,
        CanvasEdition(
            None,
            BuiltinNodeTypes.LOOP,
            (
                (_START_NODE_ID_KEY,),
                ("loop_variables", WILDCARD, "label"),
                ("break_conditions", WILDCARD, "variable_selector"),
                ("break_conditions", WILDCARD, "comparison_operator"),
            ),
            withheld=_start_child_is_written_by_the_agent,
        ),
    )
    # loop-end/default.ts:15 checks nothing
    LOOP_END = (BuiltinNodeTypes.LOOP_END,)
    # parameter-extractor/default.ts:35, 41 (provider; an empty name means no model is chosen yet), 47, 58, 71, 84
    PARAMETER_EXTRACTOR = (
        BuiltinNodeTypes.PARAMETER_EXTRACTOR,
        ("query",),
        ("model", "provider"),
        ("model", "name"),
        ("parameters",),
        ("parameters", WILDCARD, "name"),
        ("parameters", WILDCARD, "type"),
        ("parameters", WILDCARD, "description"),
    )
    # question-classifier/default.ts:57, 64 (provider; an empty name means no model is chosen yet), 70, 76
    QUESTION_CLASSIFIER = (
        BuiltinNodeTypes.QUESTION_CLASSIFIER,
        ("query_variable_selector",),
        ("model", "provider"),
        ("model", "name"),
        ("classes",),
        ("classes", WILDCARD, "name"),
    )
    # start/default.ts:20 checks nothing
    START = (BuiltinNodeTypes.START,)
    # template-transform/default.ts:26, 31, 36
    TEMPLATE_TRANSFORM = (
        BuiltinNodeTypes.TEMPLATE_TRANSFORM,
        ("template",),
        ("variables", WILDCARD, "variable"),
        ("variables", WILDCARD, "value_selector"),
    )
    # trigger-schedule/default.ts:155; the cron expression is required only in cron mode (:171-176)
    TRIGGER_SCHEDULE = (TRIGGER_SCHEDULE_NODE_TYPE, ("mode",))
    # trigger-webhook/default.ts:32 checks the webhook_url, which the server supplies
    TRIGGER_WEBHOOK = (TRIGGER_WEBHOOK_NODE_TYPE,)
    # variable-assigner/default.ts:54-59; a grouped aggregator checks its groups and each group's variables instead
    # (:42-52)
    VARIABLE_AGGREGATOR = (
        BuiltinNodeTypes.VARIABLE_AGGREGATOR,
        CanvasEdition(
            None,
            BuiltinNodeTypes.VARIABLE_AGGREGATOR,
            ((_VARIABLES_KEY,), (_VARIABLES_KEY, WILDCARD)),
            emptiness={
                (_VARIABLES_KEY,): _empty_variables_or_groups,
                (_VARIABLES_KEY, WILDCARD): _empty_ungrouped_variable,
            },
        ),
    )


def canvas_node(node_type: str) -> CanvasNode | None:
    """The canvas node of a block type; None for a type the canvas gives no defaults (tool, agent, unknown)."""
    try:
        return CanvasNode(node_type)
    except ValueError:
        return None


def _merged(written: Mapping[str, object], canvas: Mapping[str, object]) -> Mapping[str, object]:
    """A block the node wrote, plus the canvas block's missing keys; as written when it is another kind of block."""
    if _TYPE_KEY in canvas and written.get(_TYPE_KEY) != canvas[_TYPE_KEY]:
        return written
    return {**copy.deepcopy(dict(canvas)), **written}


def _edition_of(data: Mapping[str, object]) -> CanvasEdition | None:
    """The edition of the canvas node `data` is, by its type and version; None for a type or version without one."""
    node_type = data.get(_TYPE_KEY)
    if not isinstance(node_type, str):
        return None
    node = canvas_node(node_type)
    if node is None:
        return None
    return node.edition(data.get(_VERSION_KEY))


def with_canvas_defaults(data: Mapping[str, object]) -> dict[str, object]:
    """`data` plus what the canvas gives a node of its type; what `data` holds always wins.

    A missing key gets the canvas value. A dict that is there gets the canvas dict's missing keys, one level deep,
    unless the canvas dict names a `type` that the written one lacks or contradicts. Lists and scalars are never
    merged, and nothing is written as null. Data of a type the canvas gives no defaults, or of a version it does
    not know, is returned as it is.
    """
    filled = dict(data)
    edition = _edition_of(data)
    if edition is None:
        return filled
    withheld = edition.withheld(data)
    for key, canvas in edition.data.items():
        if key in withheld:
            continue
        if key not in filled:
            filled[key] = copy.deepcopy(canvas)
            continue
        written = filled[key]
        if isinstance(written, dict) and isinstance(canvas, dict):
            filled[key] = _merged(written, canvas)
    return filled


def canvas_example(data: Mapping[str, object], loc: Loc) -> object | None:
    """A copy of the canvas value at `loc` for a node as written; None where the canvas has none, or where the
    canvas value is one fill withholds from this node because it would not suit it.
    """
    edition = _edition_of(data)
    if edition is None:
        return None
    if loc and loc[0] in edition.withheld(data):
        return None
    return _value_at(edition, loc)


def untaken_keys(data: Mapping[str, object]) -> frozenset[str]:
    """The keys the node's version does not take though the editor's empty containers give them; none for a type or
    version the canvas does not know.
    """
    edition = _edition_of(data)
    if edition is None:
        return frozenset()
    return edition.untaken


def purpose_fields(data: Mapping[str, object]) -> frozenset[str | int]:
    """The top-level fields that hold a purpose loc of the node `data` is, by its type and version; none for a type or
    version the canvas does not know.
    """
    edition = _edition_of(data)
    if edition is None:
        return frozenset()
    return frozenset(loc[0] for loc in edition.purpose)


def _step(value: object, key: str | int) -> object | None:
    if isinstance(value, Mapping):
        return value.get(key)
    if isinstance(value, Sequence) and not isinstance(value, str):
        index = 0 if key == WILDCARD else key
        if isinstance(index, int) and index < len(value):
            return value[index]
    return None


def canvas_value(node_type: str, loc: Loc, *, version: object = None) -> object | None:
    """A copy of the canvas value at `loc` for a block type; None where the canvas has none. `*` is the first item."""
    node = canvas_node(node_type)
    if node is None:
        return None
    edition = node.edition(version)
    if edition is None:
        return None
    return _value_at(edition, loc)


def _value_at(edition: CanvasEdition, loc: Loc) -> object | None:
    value: object | None = edition.data
    for key in loc:
        value = _step(value, key)
        if value is None:
            return None
    return copy.deepcopy(value)


def _empty_locs(value: object, loc: Loc, path: Loc) -> list[Loc]:
    """The places under `value` that `loc` names and that are empty. A list that is missing or has no items has no
    item to name, so a `*` over it names nothing; the loc of the list itself says it must not be empty.
    """
    if not loc:
        return [path] if _is_empty(value) else []
    head, *rest = loc
    if head == WILDCARD:
        items = value if isinstance(value, list) else []
        return [found for index, item in enumerate(items) for found in _empty_locs(item, tuple(rest), (*path, index))]
    child = value.get(head) if isinstance(value, Mapping) else None
    return _empty_locs(child, tuple(rest), (*path, head))


def _empty_at(edition: CanvasEdition, data: Mapping[str, object], loc: Loc) -> list[Loc]:
    return edition.emptiness.get(loc, _empty_purpose)(data, loc)


def empty_purpose_locs(data: Mapping[str, object]) -> tuple[Loc, ...]:
    """The purpose fields of a node's data that are still empty, each as its path with `*` resolved to the real index.

    Empty is missing, None, blank text, `[]` or `{}`; a loc in the edition's `emptiness` has its own finder. A type the
    canvas does not know, and a version it does not know, have no purpose fields.
    """
    edition = _edition_of(data)
    if edition is None:
        return ()
    return tuple(empty for loc in edition.purpose for empty in _empty_at(edition, data, loc))
