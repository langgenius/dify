"""Explicit Builder presentation references, independent of translated wording.

Only callers that own fixed copy create these references. User input, generated
prose and execution evidence remain literal values; no source-string matching
or model invocation takes place here.
"""

from dataclasses import dataclass, field
from typing import Literal

from pydantic import TypeAdapter

from services.dify_builder.copy_ids import BuilderCopyId

_PARAMETERS: dict[BuilderCopyId, frozenset[str]] = {
    BuilderCopyId.BUILD_APPLY_FAILED: frozenset(["value"]),
    BuilderCopyId.BUILD_COMPLETED_DRAFT: frozenset(["count"]),
    BuilderCopyId.BUILD_GENERATION_FAILED: frozenset(["error"]),
    BuilderCopyId.BUILD_GRAPH_APPLIED: frozenset(["count", "scope"]),
    BuilderCopyId.BUILD_INVALID_GRAPH: frozenset(["value"]),
    BuilderCopyId.DIAGNOSIS_CHECKLIST_COMPLETE: frozenset(["cause", "node"]),
    BuilderCopyId.DIAGNOSIS_COMPLETE: frozenset(["cause", "node", "severity"]),
    BuilderCopyId.EDIT_ADJUST: frozenset(["targets"]),
    BuilderCopyId.EDIT_APPLIED: frozenset(["count", "scope"]),
    BuilderCopyId.EDIT_COMPLETED_DRAFT: frozenset(["changes"]),
    BuilderCopyId.EDIT_INEFFECTIVE_PROPOSAL: frozenset(["value"]),
    BuilderCopyId.EDIT_INSPECTED: frozenset(["connections", "nodes", "targets"]),
    BuilderCopyId.EDIT_INSPECTED_WITHOUT_TARGETS: frozenset(["connections", "nodes"]),
    BuilderCopyId.FORMS_TEST_DATA_CONFIRM_EFFECT: frozenset(["node", "target"]),
    BuilderCopyId.FORMS_TEST_DATA_EFFECT_ACCOUNT: frozenset(["account"]),
    BuilderCopyId.MODEL_CHANGED: frozenset(["name"]),
    BuilderCopyId.MODEL_CONFIGURATION_UNAVAILABLE: frozenset(["error"]),
    BuilderCopyId.PUBLISH_BUILD_COMPLETE: frozenset(["status", "version"]),
    BuilderCopyId.PUBLISH_COMPLETE: frozenset(["status", "version"]),
    BuilderCopyId.PUBLISH_EDIT_COMPLETE: frozenset(["status", "version"]),
    BuilderCopyId.PUBLISH_VERIFICATION_REQUIRED: frozenset(["reason"]),
    BuilderCopyId.REPAIR_APPLIED: frozenset(["count", "scope"]),
    BuilderCopyId.REPAIR_CHANGES_APPLIED: frozenset(["count", "scope"]),
    BuilderCopyId.REPAIR_INVALID_GRAPH: frozenset(["value"]),
    BuilderCopyId.REPAIR_PROPOSED: frozenset(["count", "level"]),
    BuilderCopyId.REPAIR_REASON: frozenset(["reason"]),
    BuilderCopyId.REPAIR_RISK_NOTE: frozenset(["reason"]),
    BuilderCopyId.REPAIR_STALE_PROPOSAL: frozenset(["value"]),
    BuilderCopyId.TEST_EFFECT_ALWAYS_MOCKED: frozenset(["node", "target"]),
    BuilderCopyId.TEST_EFFECT_CALLS: frozenset(["node", "target"]),
    BuilderCopyId.TEST_INVALID_INPUTS: frozenset(["reason"]),
    BuilderCopyId.TEST_MOCKED_NOTE: frozenset(["nodes"]),
}

CopyParameter = str | int | float


@dataclass(frozen=True)
class BuilderCopy:
    id: BuilderCopyId
    params: dict[str, CopyParameter] = field(default_factory=dict)
    type: Literal["copy"] = "copy"

    def __post_init__(self) -> None:
        if self.params.keys() != _PARAMETERS.get(self.id, frozenset()):
            raise ValueError(f"incorrect parameters for Builder copy {self.id}")


@dataclass(frozen=True)
class BuilderTextParts:
    parts: list[str | BuilderCopy]
    type: Literal["parts"] = "parts"


BuilderText = str | BuilderCopy | BuilderTextParts
_TEXT_ADAPTER = TypeAdapter(BuilderText)


def stored_text(value: object) -> BuilderText:
    """Decode an explicitly tagged presentation after a JSON persistence boundary."""
    return _TEXT_ADAPTER.validate_python(value)


@dataclass(kw_only=True)
class BuilderPresentation:
    # Stored with the item, so later conversation language changes do not
    # relocalize an earlier turn. Empty belongs to historical literal items.
    reply_language: str = ""


def copy_text(identifier: BuilderCopyId, **params: CopyParameter) -> BuilderCopy:
    return BuilderCopy(id=identifier, params=params)


def text_parts(*parts: BuilderText) -> BuilderTextParts:
    """Join fixed references and literal segments without formatting either."""
    flattened: list[str | BuilderCopy] = []
    for part in parts:
        if isinstance(part, BuilderTextParts):
            flattened.extend(part.parts)
        else:
            flattened.append(part)
    return BuilderTextParts(parts=flattened)
