from __future__ import annotations

from http import HTTPStatus

from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint, op_of
from controllers.openapi._models import (
    DslIssueRow,
    Hint,
    ReleaseCheckName,
    ReleaseCheckResponse,
    ReleaseCheckRow,
    ReleaseState,
)
from controllers.openapi.app_dsl import AppDslExportApi
from controllers.openapi.app_run import DRAFT_TEST_OPS
from controllers.openapi.app_workflow import VERSION_READ_GUARDS, require_draft
from controllers.openapi.auth.context import Context
from extensions.ext_application_services import application_services
from graphon.enums import WorkflowExecutionStatus
from models import AppMode, WorkflowRunTriggeredFrom
from models.workflow import Workflow
from services.workflow.graph_check import check_graph, credential_check
from services.workflow.graph_diff import WorkflowSnapshot, diff_workflows, same_graph
from services.workflow_service import WorkflowService


def _snapshot(workflow: Workflow) -> WorkflowSnapshot:
    return WorkflowSnapshot(
        graph=workflow.graph_dict,
        features=workflow.features_dict,
        environment_variable_names=frozenset(v.name for v in workflow.environment_variables),
    )


@openapi_ns.route("/apps/<string:app_id>/release:check")
class ReleaseCheckApi(Resource):
    @endpoint(
        op="check.console_app.release",
        kind=Kind.OBJECT,
        summary="Is the draft ready to publish: draft valid, last test passed on this draft, and what changed",
        examples=(Example(title="Before publishing", input={"app_id": "<app_id>"}),),
        requirements=VERSION_READ_GUARDS,
        returns=(HTTPStatus.OK, ReleaseCheckResponse, "Release check"),
    )
    def get(self, ctx: Context, app_id: str):
        draft = require_draft(ctx)
        mode = AppMode(ctx.app.mode)
        service = WorkflowService()
        environment = {v.name: v for v in draft.environment_variables}
        issues = check_graph(
            draft.graph_dict,
            mode=mode,
            resources=credential_check(ctx.workspace.id, environment, ctx.session),
        )
        runs = (
            application_services()
            .workflow_runs.get_paginate_workflow_runs(
                ctx.request_context,
                app_id=ctx.app.id,
                args={"limit": 1},
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            )
            .data
        )
        last = runs[0] if runs else None
        tested = (
            last is not None
            and last.status == WorkflowExecutionStatus.SUCCEEDED
            and same_graph(last.graph_dict, draft.graph_dict)
        )
        published = service.get_published_workflow(ctx.app, session=ctx.session)
        diff = diff_workflows(_snapshot(published) if published else None, _snapshot(draft))
        checks = [
            ReleaseCheckRow(
                name=ReleaseCheckName.DRAFT_VALID,
                passed=not issues,
                detail=f"{len(issues)} issue(s)" if issues else "No issues",
            ),
            ReleaseCheckRow(
                name=ReleaseCheckName.TESTED,
                passed=tested,
                detail="The last draft test passed on this draft"
                if tested
                else "No passing draft test on the current draft",
            ),
        ]
        hints = []
        if issues:
            hints.append(
                Hint(
                    summary="Export the draft, fix each issue by its loc, then check and import",
                    op=op_of(AppDslExportApi.get),
                    input={"app_id": ctx.app.id},
                )
            )
        if not tested:
            hints.append(
                Hint(
                    summary="Run the draft on the acceptance cases",
                    op=DRAFT_TEST_OPS[mode],
                    input={"app_id": ctx.app.id},
                )
            )
        return ReleaseCheckResponse(
            ready=all(c.passed for c in checks),
            checks=checks,
            issues=[DslIssueRow.of(i) for i in issues],
            state=ReleaseState(service_api_enabled=ctx.app.enable_api, webapp_enabled=ctx.app.enable_site),
            changes=diff,
            hints=hints,
        )
