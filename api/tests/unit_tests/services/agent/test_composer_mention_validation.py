"""Composer save/validate mention rules (ENG-616 §2.4 allowlists)."""

from __future__ import annotations

import pytest

from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import InvalidComposerConfigError
from services.entities.agent_entities import ComposerSavePayload


def _soul_payload(system_prompt: str) -> ComposerSavePayload:
    return ComposerSavePayload.model_validate(
        {
            "variant": "agent_app",
            "agent_soul": {"prompt": {"system_prompt": system_prompt}},
            "save_strategy": "save_to_current_version",
        }
    )


def _node_job_payload(workflow_prompt: str) -> ComposerSavePayload:
    return ComposerSavePayload.model_validate(
        {
            "variant": "workflow",
            "node_job": {"workflow_prompt": workflow_prompt},
            "save_strategy": "node_job_only",
        }
    )


def test_soul_prompt_accepts_soul_kinds():
    payload = _soul_payload(
        "Use {{#skill:s1#}} {{#file:f1#}} {{#tool:p/t#}} {{#cli_tool:c#}} {{#knowledge:k1#}} {{#human:h1#}}"
    )
    ComposerConfigValidator.validate_save_payload(payload)


def test_soul_prompt_rejects_node_output_mention():
    with pytest.raises(InvalidComposerConfigError, match="mention_kind_not_allowed"):
        ComposerConfigValidator.validate_save_payload(_soul_payload("Read {{#node_output:n1.text#}}"))


def test_soul_prompt_rejects_declared_output_mention():
    with pytest.raises(InvalidComposerConfigError, match="mention_kind_not_allowed"):
        ComposerConfigValidator.validate_save_payload(_soul_payload("Produce {{#output:report#}}"))


def test_node_job_prompt_accepts_job_kinds():
    payload = _node_job_payload(
        "Read {{#node_output:n1.text|START/text#}}, produce {{#output:report#}}, ask {{#human:h1#}}"
    )
    ComposerConfigValidator.validate_save_payload(payload)


@pytest.mark.parametrize("token", ["{{#skill:s1#}}", "{{#tool:p/t#}}", "{{#cli_tool:c#}}", "{{#knowledge:k1#}}"])
def test_node_job_prompt_rejects_soul_only_kinds(token: str):
    with pytest.raises(InvalidComposerConfigError, match="mention_kind_not_allowed"):
        ComposerConfigValidator.validate_save_payload(_node_job_payload(f"Use {token}"))


def test_mention_limit_enforced():
    prompt = " ".join(f"{{{{#human:h{i}#}}}}" for i in range(201))
    with pytest.raises(InvalidComposerConfigError, match="mention_limit_exceeded"):
        ComposerConfigValidator.validate_save_payload(_soul_payload(prompt))


def test_prompt_without_mentions_still_passes():
    ComposerConfigValidator.validate_save_payload(_soul_payload("plain prompt, {{var}} and {{#context#}} untouched"))
