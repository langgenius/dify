"""Parse workflow-generator answers separately from leading model reasoning."""

import re
from typing import Any

import json_repair

from graphon.nodes.llm.reasoning import split_reasoning

_THINK_CLOSE_TAG_RE = re.compile(r"</think>", re.IGNORECASE)


def parse_workflow_generator_response(text: str) -> Any:
    """Repair answer JSON without parsing a leading reasoning envelope.

    Only consume complete envelopes at the beginning of the response. The
    existing reasoning owner recognizes each isolated envelope; applying it
    to the entire answer would also strip literal tags inside JSON strings.
    A recognized unclosed envelope has no answer and yields non-object JSON,
    leaving rejection and correction budgets with the generator's caller.
    """
    answer = text.lstrip()
    while answer.lower().startswith("<think"):
        closing_tag = _THINK_CLOSE_TAG_RE.search(answer)
        envelope = answer[: closing_tag.end()] if closing_tag is not None else answer
        clean_envelope, _ = split_reasoning(envelope, "separated")
        if clean_envelope:
            # The existing owner did not recognize a leading envelope. Keep
            # the response intact for the same JSON repair behavior as before.
            break
        if closing_tag is None:
            answer = ""
            break
        answer = answer[closing_tag.end() :].lstrip()
    return json_repair.loads(answer)
