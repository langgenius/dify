"""Test-data form fields and replies for the Test Run effect disclosure (PRD §9.1, 超出边界确认卡).

The disclosure travels with the existing test-data form: one checkbox per side
effect names the node, its target and account, unticked by default so the
default stays Mock. Read and model calls and destructive steps are listed in
the reply that carries the form.
"""

from collections.abc import Mapping, Sequence

from core.dify_builder.contract import FormField
from core.dify_builder.models import NodeOutput
from runtime_contracts.builder.copy_ids import BuilderCopyId
from runtime_contracts.builder.presentation import BuilderText, copy_text, text_parts
from services.dify_builder.effect_disclosure import EffectDisclosure, confirm_field_key
from services.dify_builder.execution_messages import code_risk_unavailable_notice


def effect_confirmation_fields(disclosure: EffectDisclosure) -> list[FormField]:
    fields: list[FormField] = []
    for item in disclosure.confirmable:
        details: list[BuilderText] = []
        if item.account:
            details.append(copy_text(BuilderCopyId.FORMS_TEST_DATA_EFFECT_ACCOUNT, account=item.account))
        if item.object:
            details.append(item.object)
        if item.risk_notice:
            details.append(item.risk_notice)
        hint = text_parts(*_joined(details, " · ")) if details else None
        fields.append(
            FormField(
                key=confirm_field_key(item.node_id),
                label=copy_text(
                    BuilderCopyId.FORMS_TEST_DATA_CONFIRM_EFFECT, node=item.title, target=item.target or item.node_type
                ),
                type="checkbox",
                default=False,
                hint=hint,
            )
        )
    return fields


def effect_confirmation_values(disclosure: EffectDisclosure, confirmation: Mapping[str, str]) -> dict[str, bool]:
    """Keep a still-valid earlier confirmation ticked when the form is shown again."""
    return {
        confirm_field_key(item.node_id): confirmation.get(item.node_id) == item.signature
        for item in disclosure.confirmable
    }


def effects_note(disclosure: EffectDisclosure, *, reply_language: str = "") -> BuilderText | None:
    """The reply lines that accompany the form; ``None`` when the run touches nothing outside Dify."""
    reads = disclosure.by_tier("read")
    destructive = disclosure.by_tier("destructive")
    code = tuple(item for item in disclosure.items if item.node_type == "code" and item.risk_notice)
    if not (reads or destructive or disclosure.confirmable or code):
        return None
    lines: list[BuilderText] = [copy_text(BuilderCopyId.TEST_EFFECTS_INTRO)]
    lines += [
        copy_text(BuilderCopyId.TEST_EFFECT_CALLS, node=item.title, target=item.target or item.node_type)
        for item in reads
    ]
    lines += [
        copy_text(BuilderCopyId.TEST_EFFECT_ALWAYS_MOCKED, node=item.title, target=item.target or item.node_type)
        for item in destructive
    ]
    for item in code:
        notice = (
            code_risk_unavailable_notice(reply_language)
            if item.assessment_status == "unavailable"
            else item.risk_notice
        )
        lines.append(f"{item.title}: {notice}")
    if disclosure.confirmable:
        lines.append(copy_text(BuilderCopyId.TEST_EFFECT_CONFIRM_REQUIRED))
    return text_parts(*_joined(lines, "\n"))


def with_effects_note(reply: BuilderText, note: BuilderText | None) -> BuilderText:
    return text_parts(reply, "\n\n", note) if note is not None else reply


def mocked_note(simulated_node_ids: Sequence[str], per_node: Sequence[NodeOutput]) -> BuilderText | None:
    if not simulated_node_ids:
        return None
    titles = {node.node_id: node.title for node in per_node if node.title}
    names = ", ".join(titles.get(node_id, node_id) for node_id in simulated_node_ids)
    return copy_text(BuilderCopyId.TEST_MOCKED_NOTE, nodes=names)


def _joined(parts: Sequence[BuilderText], separator: str) -> list[BuilderText]:
    joined: list[BuilderText] = []
    for index, part in enumerate(parts):
        if index:
            joined.append(separator)
        joined.append(part)
    return joined
