"""The session locale controls new plan prose even when requirements are English."""

from unittest.mock import patch

from services.dify_builder.agent import build


def test_plan_uses_explicit_session_reply_language() -> None:
    with patch.object(build.llm, "invoke_text", return_value="{}") as invoke:
        build.propose_plan_v1(object(), {"goal": "Return customer_id in USD"}, reply_language="zh-CN")
    system = invoke.call_args.kwargs["system"]
    assert "BCP-47: zh-CN" in system
    assert "resource IDs" in system
    assert "literal business values unchanged" in system
