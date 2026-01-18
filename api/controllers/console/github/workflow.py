import logging

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models import App
from models.github_connection import GitHubConnection
from services.github.workflow_git_service import WorkflowGitService
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)


class WorkflowPushPayload(BaseModel):
    app_id: str = Field(description="App ID")
    workflow_id: str | None = Field(default=None, description="Workflow ID (defaults to draft workflow)")
    commit_message: str | None = Field(default=None, description="Custom commit message")
    branch: str | None = Field(default=None, description="Branch name (defaults to connection's branch)")
    include_secret: bool = Field(default=False, description="Whether to include secret values")


class WorkflowPullPayload(BaseModel):
    app_id: str = Field(description="App ID")
    workflow_id: str | None = Field(default=None, description="Workflow ID to update (defaults to draft workflow)")
    branch: str | None = Field(default=None, description="Branch name (defaults to connection's branch)")


@console_ns.route("/github/workflows/push")
class WorkflowPush(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("push_workflow_to_github")
    def post(self):
        """Push workflow to GitHub repository."""
        account, tenant = current_account_with_tenant()

        payload = WorkflowPushPayload.model_validate(request.json)

        # Get app
        app = db.session.get(App, payload.app_id)
        if not app or app.tenant_id != tenant:
            raise NotFound("App not found")

        # Get GitHub connection for this app
        connection = (
            db.session.query(GitHubConnection)
            .where(
                GitHubConnection.tenant_id == tenant,
                GitHubConnection.app_id == payload.app_id,
            )
            .first()
        )

        if not connection:
            raise NotFound("GitHub connection not found for this app")

        # Get workflow
        workflow_service = WorkflowService()
        if payload.workflow_id:
            workflow = workflow_service.get_published_workflow_by_id(app, payload.workflow_id)
        else:
            workflow = workflow_service.get_draft_workflow(app)

        if not workflow:
            raise NotFound("Workflow not found")

        # Push workflow
        git_service = WorkflowGitService(connection)
        try:
            result = git_service.push_workflow(
                workflow=workflow,
                commit_message=payload.commit_message,
                branch=payload.branch,
                include_secret=payload.include_secret,
            )
            return {
                "success": True,
                "commit": {
                    "sha": result.get("commit", {}).get("sha"),
                    "message": result.get("commit", {}).get("message"),
                    "url": result.get("commit", {}).get("html_url"),
                },
            }
        except ValueError as e:
            logger.exception("Failed to push workflow to GitHub")
            raise BadRequest(str(e)) from e
        except Exception as e:
            logger.exception("Unexpected error pushing workflow to GitHub")
            raise BadRequest(f"Failed to push workflow: {str(e)}") from e


@console_ns.route("/github/workflows/pull")
class WorkflowPull(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("pull_workflow_from_github")
    def post(self):
        """Pull workflow from GitHub repository."""
        account, tenant = current_account_with_tenant()

        payload = WorkflowPullPayload.model_validate(request.json)

        # Get app
        app = db.session.get(App, payload.app_id)
        if not app or app.tenant_id != tenant:
            raise NotFound("App not found")

        # Get GitHub connection for this app
        connection = (
            db.session.query(GitHubConnection)
            .where(
                GitHubConnection.tenant_id == tenant,
                GitHubConnection.app_id == payload.app_id,
            )
            .first()
        )

        if not connection:
            raise NotFound("GitHub connection not found for this app")

        # Pull workflow
        git_service = WorkflowGitService(connection)
        try:
            workflow = git_service.pull_workflow(
                app=app,
                branch=payload.branch,
                workflow_id=payload.workflow_id,
            )
            return {
                "success": True,
                "workflow": {
                    "id": workflow.id,
                    "version": workflow.version,
                    "updated_at": workflow.updated_at.isoformat() if workflow.updated_at else None,
                },
            }
        except ValueError as e:
            logger.exception("Failed to pull workflow from GitHub")
            raise BadRequest(str(e)) from e
        except Exception as e:
            logger.exception("Unexpected error pulling workflow from GitHub")
            raise BadRequest(f"Failed to pull workflow: {str(e)}") from e


@console_ns.route("/github/workflows/commits")
class WorkflowCommits(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("get_workflow_commit_history")
    def get(self):
        """Get commit history for workflow file."""
        account, tenant = current_account_with_tenant()

        app_id = request.args.get("app_id")
        branch = request.args.get("branch")
        limit = int(request.args.get("limit", 30))

        if not app_id:
            raise BadRequest("app_id is required")

        # Get app
        app = db.session.get(App, app_id)
        if not app or app.tenant_id != tenant:
            raise NotFound("App not found")

        # Get GitHub connection for this app
        connection = (
            db.session.query(GitHubConnection)
            .where(
                GitHubConnection.tenant_id == tenant,
                GitHubConnection.app_id == app_id,
            )
            .first()
        )

        if not connection:
            raise NotFound("GitHub connection not found for this app")

        # Get commit history
        git_service = WorkflowGitService(connection)
        try:
            commits = git_service.get_workflow_commit_history(branch=branch, limit=limit)
            return {
                "commits": [
                    {
                        "sha": commit.get("sha"),
                        "message": commit.get("commit", {}).get("message"),
                        "author": commit.get("commit", {}).get("author", {}).get("name"),
                        "date": commit.get("commit", {}).get("author", {}).get("date"),
                        "url": commit.get("html_url"),
                    }
                    for commit in commits
                ],
            }
        except Exception as e:
            logger.exception("Failed to get workflow commit history")
            raise BadRequest(f"Failed to get commit history: {str(e)}") from e
