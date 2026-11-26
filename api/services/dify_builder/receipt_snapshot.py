"""Freeze submitted presentation independently of execution input values."""

from collections.abc import Mapping

from core.dify_builder.contract import InteractionResponseItem
from core.dify_builder.errors import BadRequestError


def apply_receipt_snapshot(receipt: InteractionResponseItem, snapshot: Mapping[str, object]) -> None:
    if snapshot["interaction_kind"] != receipt.interaction_kind:
        raise BadRequestError("receipt snapshot does not match the interaction")
    fields = snapshot.get("fields", [])
    assert isinstance(fields, list)
    if [field["key"] for field in fields] != [field.key for field in receipt.fields]:
        raise BadRequestError("receipt snapshot does not match the form fields")
    # The transport validates string types. Only display properties
    # are copied; raw values and option/resource IDs are always server-derived.
    question, answer, language = snapshot["question"], snapshot["answer"], snapshot["reply_language"]
    assert isinstance(question, str)
    assert isinstance(answer, str)
    assert isinstance(language, str)
    receipt.question, receipt.answer, receipt.reply_language = question, answer, language
    for field, displayed in zip(receipt.fields, fields, strict=True):
        field.label = displayed["label"]
        field.display_value = displayed["display_value"]
