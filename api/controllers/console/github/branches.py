import logging

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models.github_connection import GitHubConnection
from services.github.github_api_client import GitHubAPIClient

logger = logging.getLogger(__name__)


class CreateBranchPayload(BaseModel):
    app_id: str = Field(description="App ID")
    branch_name: str = Field(description="New branch name")
    from_branch: str = Field(default="main", description="Source branch name")


@console_ns.route("/github/branches")
class GitHubBranches(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("create_github_branch")
    def post(self):
        """Create a new branch in the GitHub repository."""
        account, tenant = current_account_with_tenant()
        
        payload = CreateBranchPayload.model_validate(request.json)
        
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
        
        if not connection.repository_name:
            raise BadRequest("Repository not configured")
        
        try:
            client = GitHubAPIClient(connection)
            result = client.create_branch(
                branch_name=payload.branch_name,
                from_branch=payload.from_branch,
            )
            return {
                "success": True,
                "branch": {
                    "name": payload.branch_name,
                    "sha": result.get("object", {}).get("sha"),
                    "url": result.get("url"),
                },
            }
        except ValueError as e:
            logger.exception("Failed to create GitHub branch")
            raise BadRequest(str(e)) from e
        except Exception as e:
            logger.exception("Unexpected error creating GitHub branch")
            raise BadRequest(f"Failed to create branch: {str(e)}") from e


@console_ns.route("/github/branches/list")
class GitHubBranchesList(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("list_github_branches_by_app")
    def get(self):
        """List branches for a specific app's GitHub connection."""
        account, tenant = current_account_with_tenant()
        
        app_id = request.args.get("app_id")
        if not app_id:
            raise BadRequest("app_id is required")
        
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
        
        if not connection.repository_name:
            raise BadRequest("Repository not configured")
        
        try:
            client = GitHubAPIClient(connection)
            branches = client.list_branches()
            return {
                "data": [
                    {
                        "name": branch.get("name"),
                        "sha": branch.get("commit", {}).get("sha"),
                        "protected": branch.get("protected", False),
                    }
                    for branch in branches
                ],
            }
        except Exception as e:
            logger.exception("Failed to list GitHub branches")
            raise BadRequest(f"Failed to list branches: {str(e)}") from e

