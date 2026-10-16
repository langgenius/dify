"""Revision-token policy shared by request admission and queued execution."""

from core.dify_builder.models import Action


def requires_app_revision(action: Action) -> bool:
    """Input values and conversation/model commands do not bind a draft revision.

    The presence of HTTP fixtures, including an empty fixture list, binds
    testdata to the exact revision admitted by the fixture owner. Session
    versions and the Builder's recovery baseline are independent checks.
    """
    return action.kind not in {"message", "update_model"} and not (
        action.kind == "provide_testdata" and "http_fixtures" not in action.payload
    )
