"""What the web canvas gives a new node of each block type, and the fields a node of that type must not leave empty.

The values are generated from the web's `default.ts` files (web/scripts/generate-node-defaults.ts). The purpose
locs are written by hand from each node's `checkValid`, which is code with translated text and cannot be generated.
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from importlib import resources
from typing import Final, Self

from pydantic import TypeAdapter

from core.trigger.constants import TRIGGER_SCHEDULE_NODE_TYPE, TRIGGER_WEBHOOK_NODE_TYPE
from graphon.enums import BuiltinNodeTypes
from graphon.model_runtime.entities.llm_entities import LLMMode
from services.knowledge_fs.knowledge_retrieval_v2.entities import KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE

type Loc = tuple[str | int, ...]

WILDCARD: Final = "*"
_TYPE_KEY: Final = "type"
_VERSION_KEY: Final = "version"
_HUMAN_INPUT_V2_ENTRY: Final = "human-input-v2"
_DEFAULTS_FILE: Final = "canvas_defaults.json"
_DEFAULTS: Final = TypeAdapter(dict[str, dict[str, object]]).validate_json(
    resources.files(__package__).joinpath(_DEFAULTS_FILE).read_text(encoding="utf-8")
)


def _nothing_withheld(_written: Mapping[str, object]) -> frozenset[str]:
    return frozenset()


def _completion_model_has_no_chat_prompt(written: Mapping[str, object]) -> frozenset[str]:
    """The canvas prompt is a chat message list; a node written for a completion model needs a text prompt."""
    model = written.get("model")
    if isinstance(model, Mapping) and model.get("mode") == LLMMode.COMPLETION:
        return frozenset({"prompt_template"})
    return frozenset()


@dataclass(frozen=True)
class CanvasEdition:
    """What the canvas gives a node of one version of a block type, from the web entry `entry`.

    `withheld` names the canvas keys not to write for the node as written, because the canvas value would not suit it.
    """

    version: str | None
    entry: str
    purpose: tuple[Loc, ...]
    withheld: Callable[[Mapping[str, object]], frozenset[str]] = _nothing_withheld

    @property
    def data(self) -> Mapping[str, object]:
        return _DEFAULTS.get(self.entry, {})


class CanvasNode(StrEnum):
    """A block type the canvas adds. `data` is what the canvas gives a new node of it, as generated from the web.

    `purpose` lists the fields the web's `checkValid` rejects when empty, each as the path to it; `*` stands for
    each item of a list. Conditions that depend on other fields (an operator that takes no value, a mode) are not
    listed.

    A member is given either the purpose locs of its one edition, or one `CanvasEdition` per version when the versions
    differ. `data` and `purpose` are those of the first edition, which is the version a node without one has.
    `edition` picks by a node's version.
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
    # iteration/default.ts:32, 39
    ITERATION = (BuiltinNodeTypes.ITERATION, ("iterator_selector",), ("output_selector",))
    # knowledge-retrieval/default.ts:35; the model is required only for single retrieval (:41-45)
    KNOWLEDGE_RETRIEVAL = (BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, ("dataset_ids",))
    # knowledge-retrieval-v2/default.ts:31; the text or the image query is enough (:27)
    KNOWLEDGE_RETRIEVAL_V2 = (KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE, ("control_space_ids",))
    # list-operator/default.ts:43; the filter condition is required only when the filter is on (:50-75)
    LIST_OPERATOR = (BuiltinNodeTypes.LIST_OPERATOR, ("variable",))
    LLM = (
        BuiltinNodeTypes.LLM,
        # llm/default.ts:92-99 (provider), 101-117 (a prompt is empty when every message's text is ""); a prompt for a
        # completion model is not the canvas's chat list (:103-111)
        CanvasEdition(
            None,
            BuiltinNodeTypes.LLM,
            (("model", "provider"), ("prompt_template",)),
            withheld=_completion_model_has_no_chat_prompt,
        ),
    )
    # loop/default.ts:36, 51, 57
    LOOP = (
        BuiltinNodeTypes.LOOP,
        ("loop_variables", WILDCARD, "label"),
        ("break_conditions", WILDCARD, "variable_selector"),
        ("break_conditions", WILDCARD, "comparison_operator"),
    )
    # loop-end/default.ts:15 checks nothing
    LOOP_END = (BuiltinNodeTypes.LOOP_END,)
    # parameter-extractor/default.ts:35, 41, 47, 58, 71, 84
    PARAMETER_EXTRACTOR = (
        BuiltinNodeTypes.PARAMETER_EXTRACTOR,
        ("query",),
        ("model", "provider"),
        ("parameters",),
        ("parameters", WILDCARD, "name"),
        ("parameters", WILDCARD, "type"),
        ("parameters", WILDCARD, "description"),
    )
    # question-classifier/default.ts:57, 64, 70, 76
    QUESTION_CLASSIFIER = (
        BuiltinNodeTypes.QUESTION_CLASSIFIER,
        ("query_variable_selector",),
        ("model", "provider"),
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
    # variable-assigner/default.ts:54-59; a grouped aggregator checks each group's variables instead (:42-52)
    VARIABLE_AGGREGATOR = (BuiltinNodeTypes.VARIABLE_AGGREGATOR, ("variables",), ("variables", WILDCARD))


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


def with_canvas_defaults(data: Mapping[str, object]) -> dict[str, object]:
    """`data` plus what the canvas gives a node of its type; what `data` holds always wins.

    A missing key gets the canvas value. A dict that is there gets the canvas dict's missing keys, one level deep,
    unless the canvas dict names a `type` that the written one lacks or contradicts. Lists and scalars are never
    merged, and nothing is written as null. Data of a type the canvas gives no defaults, or of a version it does
    not know, is returned as it is.
    """
    filled = dict(data)
    node_type = data.get(_TYPE_KEY)
    if not isinstance(node_type, str):
        return filled
    node = canvas_node(node_type)
    if node is None:
        return filled
    edition = node.edition(data.get(_VERSION_KEY))
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


def _step(value: object, key: str | int) -> object | None:
    if isinstance(value, Mapping):
        return value.get(key)
    if isinstance(value, Sequence) and not isinstance(value, str):
        index = 0 if key == WILDCARD else key
        if isinstance(index, int) and index < len(value):
            return value[index]
    return None


def canvas_value(node_type: str, loc: Loc, *, version: str | None = None) -> object | None:
    """A copy of the canvas value at `loc` for a block type; None where the canvas has none. `*` is the first item."""
    node = canvas_node(node_type)
    if node is None:
        return None
    edition = node.edition(version)
    if edition is None:
        return None
    value: object | None = edition.data
    for key in loc:
        value = _step(value, key)
        if value is None:
            return None
    return copy.deepcopy(value)
