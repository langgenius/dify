"""All repair apply owners summarize the actual native graph diff."""

from datetime import datetime

import pytest

from core.dify_builder.models import (
    Actor,
    DifyBuilderContext,
    EntryMode,
    Session,
    Turn,
)
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, FixtureEnv, InMemoryRepository, StubAgent
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text


@pytest.mark.parametrize("mode", ["build", "edit", "fix"])
def test_proposal_owners_show_business_title_rationale_and_retest_boundary(mode: str) -> None:
    from core.dify_builder.models import Diagnosis
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from services.dify_builder.application.handlers_edit import handle_test_affected_paths
    from services.dify_builder.repair_gate import handle_propose

    port = FakeBuildDifyPort()
    port.verify_pass = False
    port.graph = {"nodes": [{"id": "output", "data": {"type": "end", "title": "Present release summary"}}], "edges": []}
    env = FixtureEnv(dify=port, agent=StubAgent(), repo=InMemoryRepository(), now=lambda: datetime.min)
    context = DifyBuilderContext(
        source="checklist",
        diagnosis=Diagnosis(culprit_node_id="output"),
        built_node_ids=["output"],
        edit_target_node_ids=["output"],
    )
    states = {
        "build": PcState.BUILD_TEST_AND_REPAIR,
        "edit": PcState.EDIT_TEST_AFFECTED_PATHS,
        "fix": PcState.FIX_PROPOSE,
    }
    session = Session(id="s", app_id="app", entry_mode=EntryMode.FIX, current_state=states[mode])
    handler = {"build": handle_test_and_repair, "edit": handle_test_affected_paths, "fix": handle_propose}[mode]
    result = handler(env, Turn(actor=Actor(account_id="a", tenant_id="t")), session, context)
    reply = english_text(next(item.payload["reply_text"] for item in result.items if item.kind == "assistant_turn"))
    assert "Present release summary" in reply
    assert r"config\-only fix" in reply
    assert "new Test Run" in reply
    assert "set_node_config" not in reply
    assert port.applied == []
