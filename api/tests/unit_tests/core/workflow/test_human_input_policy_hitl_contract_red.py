from __future__ import annotations

import importlib

from graphon.entities.pause_reason import PauseReasonType


def test_enrich_human_input_pause_reasons_uses_session_id_for_hitl_contract() -> None:
    module = importlib.import_module("core.workflow.human_input_policy")

    enriched = module.enrich_human_input_pause_reasons(
        [
            {
                "TYPE": PauseReasonType.HITL_REQUIRED,
                "session_id": "session-1",
                "node_id": "node-1",
                "node_title": "Approval Gate",
            }
        ],
        dispositions_by_form_id={
            "session-1": module.FormDisposition(form_token="token-1", approval_channels=["console"])
        },
        expiration_times_by_form_id={"session-1": 1704067200},
    )

    assert enriched == [
        {
            "TYPE": PauseReasonType.HITL_REQUIRED,
            "session_id": "session-1",
            "node_id": "node-1",
            "node_title": "Approval Gate",
            "form_token": "token-1",
            "approval_channels": ["console"],
            "expiration_time": 1704067200,
        }
    ]
