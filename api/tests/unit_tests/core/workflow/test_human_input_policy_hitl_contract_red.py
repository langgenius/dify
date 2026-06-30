from __future__ import annotations

import importlib

from graphon.entities.pause_reason import PauseReasonType


def test_enrich_human_input_pause_reasons_maps_session_id_to_public_form_id() -> None:
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
            "form-1": module.FormDisposition(form_token="token-1", approval_channels=["console"])
        },
        expiration_times_by_form_id={"form-1": 1704067200},
        form_ids_by_session_id={"session-1": "form-1"},
    )

    assert enriched == [
        {
            "TYPE": PauseReasonType.HITL_REQUIRED,
            "form_id": "form-1",
            "node_id": "node-1",
            "node_title": "Approval Gate",
            "form_token": "token-1",
            "approval_channels": ["console"],
            "expiration_time": 1704067200,
        }
    ]
