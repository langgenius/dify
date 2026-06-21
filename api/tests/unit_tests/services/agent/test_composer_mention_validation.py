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
    payload = _soul_payload("Use [§skill:s1§] [§file:f1§] [§tool:p/t§] [§cli_tool:c§] [§knowledge:k1§] [§human:h1§]")
    ComposerConfigValidator.validate_save_payload(payload)


def test_soul_prompt_rejects_node_output_mention():
    with pytest.raises(InvalidComposerConfigError, match="mention_kind_not_allowed"):
        ComposerConfigValidator.validate_save_payload(_soul_payload("Read [§node_output:n1.text§]"))


def test_soul_prompt_rejects_declared_output_mention():
    with pytest.raises(InvalidComposerConfigError, match="mention_kind_not_allowed"):
        ComposerConfigValidator.validate_save_payload(_soul_payload("Produce [§output:report§]"))


def test_node_job_prompt_accepts_job_kinds():
    payload = _node_job_payload("Read [§node_output:n1.text:START/text§], produce [§output:report§], ask [§human:h1§]")
    ComposerConfigValidator.validate_save_payload(payload)


@pytest.mark.parametrize("token", ["[§skill:s1§]", "[§tool:p/t§]", "[§cli_tool:c§]", "[§knowledge:k1§]"])
def test_node_job_prompt_rejects_soul_only_kinds(token: str):
    with pytest.raises(InvalidComposerConfigError, match="mention_kind_not_allowed"):
        ComposerConfigValidator.validate_save_payload(_node_job_payload(f"Use {token}"))


def test_mention_limit_enforced():
    prompt = " ".join(f"[§human:h{i}§]" for i in range(201))
    with pytest.raises(InvalidComposerConfigError, match="mention_limit_exceeded"):
        ComposerConfigValidator.validate_save_payload(_soul_payload(prompt))


def test_prompt_without_mentions_still_passes():
    ComposerConfigValidator.validate_save_payload(_soul_payload("plain prompt, {{var}} and {{#context#}} untouched"))


# ── ENG-617: human must be referenced (hard) ─────────────────────────────────


def _soul_payload_with_human(system_prompt: str) -> ComposerSavePayload:
    return ComposerSavePayload.model_validate(
        {
            "variant": "agent_app",
            "agent_soul": {
                "prompt": {"system_prompt": system_prompt},
                "human": {
                    "contacts": [{"id": "c-1", "name": "David Hayes", "email": "david@acme.com", "channel": "email"}]
                },
            },
            "save_strategy": "save_to_current_version",
        }
    )


def test_configured_human_without_mention_is_rejected():
    with pytest.raises(InvalidComposerConfigError, match="human_involvement_not_referenced"):
        ComposerConfigValidator.validate_save_payload(_soul_payload_with_human("no human reference here"))


def test_configured_human_referenced_by_id_passes():
    ComposerConfigValidator.validate_save_payload(_soul_payload_with_human("ask [§human:c-1§] when unsure"))


def test_configured_human_referenced_by_email_alias_passes():
    ComposerConfigValidator.validate_save_payload(_soul_payload_with_human("ask [§human:david@acme.com§]"))


def test_node_job_human_must_be_referenced_too():
    payload = ComposerSavePayload.model_validate(
        {
            "variant": "workflow",
            "node_job": {
                "workflow_prompt": "do the work",
                "human_contacts": [{"id": "c-2", "name": "Reviewer"}],
            },
            "save_strategy": "node_job_only",
        }
    )
    with pytest.raises(InvalidComposerConfigError, match="human_involvement_not_referenced"):
        ComposerConfigValidator.validate_save_payload(payload)

    payload.node_job.workflow_prompt = "escalate to [§human:c-2§]"
    ComposerConfigValidator.validate_save_payload(payload)


def test_identity_less_human_contact_is_skipped():
    payload = ComposerSavePayload.model_validate(
        {
            "variant": "agent_app",
            "agent_soul": {
                "prompt": {"system_prompt": "plain"},
                "human": {"contacts": [{"channel": "email"}]},
            },
            "save_strategy": "save_to_current_version",
        }
    )
    ComposerConfigValidator.validate_save_payload(payload)


# ── ENG-617: soft findings ───────────────────────────────────────────────────


def _findings(payload: ComposerSavePayload, **kwargs):
    return ComposerConfigValidator.collect_soft_findings(payload, **kwargs)


def test_dangling_knowledge_mention_becomes_placeholder_with_label():
    payload = _soul_payload("ground in [§knowledge:gone-1:旧产品手册§]")
    findings = _findings(payload)
    assert findings["knowledge_retrieval_placeholder"] == [{"id": "gone-1", "placeholder_name": "旧产品手册"}]
    assert findings["warnings"] == []


def test_dangling_knowledge_without_label_gets_fallback_name():
    findings = _findings(_soul_payload("see [§knowledge:deadbeef-cafe§]"))
    assert findings["knowledge_retrieval_placeholder"] == [
        {"id": "deadbeef-cafe", "placeholder_name": "Knowledge deadbeef"}
    ]


def test_configured_but_deleted_dataset_surfaces_as_placeholder():
    payload = ComposerSavePayload.model_validate(
        {
            "variant": "agent_app",
            "agent_soul": {
                "prompt": {"system_prompt": "see [§knowledge:ds-1:产品手册§]"},
                "knowledge": {"datasets": [{"id": "ds-1", "name": "产品手册"}]},
            },
            "save_strategy": "save_to_current_version",
        }
    )
    # configured + DB row exists -> clean
    assert _findings(payload, existing_dataset_ids={"ds-1"})["knowledge_retrieval_placeholder"] == []
    # configured but deleted in DB -> placeholder
    assert _findings(payload, existing_dataset_ids=set())["knowledge_retrieval_placeholder"] == [
        {"id": "ds-1", "placeholder_name": "产品手册"}
    ]


def test_unresolved_non_knowledge_mentions_warn_target_missing():
    findings = _findings(_soul_payload("use [§skill:nope:Ghost Skill§] and [§human:missing§]"))
    codes = [(w["code"], w["kind"]) for w in findings["warnings"]]
    assert ("mention_target_missing", "skill") in codes
    assert ("mention_target_missing", "human") in codes
    assert findings["knowledge_retrieval_placeholder"] == []


def test_provider_all_tools_mention_resolves_against_provider_level_entry():
    # `[§tool:<provider>/*§]` = all tools of that provider; it points at a
    # provider-level config entry (tool_name omitted), so with the entry present
    # it must produce neither hard error nor warning…
    payload = ComposerSavePayload.model_validate(
        {
            "variant": "agent_app",
            "agent_soul": {
                "prompt": {"system_prompt": "use [§tool:duckduckgo/*:DuckDuckGo 全部§] when needed"},
                "tools": {
                    "dify_tools": [
                        {
                            "plugin_id": "langgenius/duckduckgo",
                            "provider": "duckduckgo",
                            "credential_type": "unauthorized",
                        }
                    ]
                },
            },
            "save_strategy": "save_to_current_version",
        }
    )
    ComposerConfigValidator.validate_save_payload(payload)
    assert _findings(payload) == {"warnings": [], "knowledge_retrieval_placeholder": []}

    # …and without any entry of that provider it warns like any dangling mention.
    dangling = _findings(_soul_payload("use [§tool:duckduckgo/*:DuckDuckGo 全部§]"))
    assert [(w["code"], w["kind"]) for w in dangling["warnings"]] == [("mention_target_missing", "tool")]


def test_duplicate_cli_tool_ids_rejected():
    payload = ComposerSavePayload.model_validate(
        {
            "variant": "agent_app",
            "agent_soul": {
                "prompt": {"system_prompt": "plain"},
                "tools": {
                    "cli_tools": [
                        {"id": "ct-1", "name": "ffmpeg"},
                        # disabled entries still occupy the id namespace
                        {"id": "ct-1", "name": "pandoc", "enabled": False},
                    ]
                },
            },
            "save_strategy": "save_to_current_version",
        }
    )
    with pytest.raises(InvalidComposerConfigError, match="duplicate CLI tool id 'ct-1'"):
        ComposerConfigValidator.validate_save_payload(payload)


def test_save_backfills_missing_cli_tool_ids_and_keeps_existing():
    from services.agent.composer_service import _backfill_cli_tool_ids

    payload = ComposerSavePayload.model_validate(
        {
            "variant": "agent_app",
            "agent_soul": {
                "prompt": {"system_prompt": "plain"},
                "tools": {"cli_tools": [{"name": "ffmpeg"}, {"id": "ct-1", "name": "pandoc"}]},
            },
            "save_strategy": "save_to_current_version",
        }
    )

    _backfill_cli_tool_ids(payload.agent_soul)

    assert payload.agent_soul is not None
    minted, existing = payload.agent_soul.tools.cli_tools
    assert existing.id == "ct-1"
    assert minted.id is not None
    assert len(minted.id) == 12
    assert minted.id != "ct-1"


def test_malformed_marker_warns_but_does_not_block():
    payload = _soul_payload("hello [§wat:x:y§] world")
    ComposerConfigValidator.validate_save_payload(payload)  # no hard error
    findings = _findings(payload)
    assert [w["code"] for w in findings["warnings"]] == ["mention_malformed"]


def test_clean_prompt_yields_empty_findings():
    findings = _findings(_soul_payload("plain prompt with {{#context#}} legacy form"))
    assert findings == {"warnings": [], "knowledge_retrieval_placeholder": []}
