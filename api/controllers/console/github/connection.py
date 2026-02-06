import logging

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy import select
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models.github_connection import GitHubConnection
from services.github.github_api_client import GitHubAPIClient

logger = logging.getLogger(__name__)


class GitHubConnectionListQuery(BaseModel):
    app_id: str | None = Field(default=None, description="Filter by app ID")


class GitHubConnectionCreatePayload(BaseModel):
    app_id: str | None = Field(default=None, description="App ID (optional for workspace-level connections)")
    repository_owner: str = Field(description="GitHub repository owner")
    repository_name: str = Field(description="GitHub repository name")
    branch: str = Field(default="main", description="Default branch name")
    oauth_state: str | None = Field(default=None, description="OAuth state to retrieve stored token")


class GitHubConnectionUpdatePayload(BaseModel):
    repository_owner: str | None = Field(default=None, description="GitHub repository owner")
    repository_name: str | None = Field(default=None, description="GitHub repository name")
    branch: str | None = Field(default=None, description="Default branch name")
    workflow_file_path: str | None = Field(default=None, description="Path to workflow file in repository")


@console_ns.route("/github/connections")
class GitHubConnectionList(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("list_github_connections")
    def get(self):
        """List GitHub connections for the current tenant."""
        _account, tenant = current_account_with_tenant()

        query_params = GitHubConnectionListQuery.model_validate(request.args.to_dict())
        filters = [GitHubConnection.tenant_id == tenant]

        if query_params.app_id:
            filters.append(GitHubConnection.app_id == query_params.app_id)

        stmt = select(GitHubConnection).where(*filters).order_by(GitHubConnection.created_at.desc())
        connections = db.session.scalars(stmt).all()

        return {
            "data": [conn.to_dict(include_tokens=False) for conn in connections],
        }

    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("create_github_connection")
    def post(self):
        """Create a new GitHub connection (after OAuth)."""
        _account, tenant = current_account_with_tenant()

        payload = GitHubConnectionCreatePayload.model_validate(request.json)

        # Check if connection already exists for this app (only one connection per app)
        if payload.app_id:
            existing_app_connection = (
                db.session.query(GitHubConnection)
                .where(
                    GitHubConnection.tenant_id == tenant,
                    GitHubConnection.app_id == payload.app_id,
                )
                .first()
            )
            if existing_app_connection:
                repo_info = (
                    existing_app_connection.repository_full_name
                    if existing_app_connection.repository_name
                    else "Pending connection (incomplete)"
                )
                raise BadRequest(
                    f"App already has a GitHub connection. "
                    f"Please disconnect the existing connection first (Repository: {repo_info})"
                )

        # Check if connection already exists for this repository (prevent duplicates)
        filters = [
            GitHubConnection.tenant_id == tenant,
            GitHubConnection.repository_owner == payload.repository_owner,
            GitHubConnection.repository_name == payload.repository_name,
        ]
        if payload.app_id:
            filters.append(GitHubConnection.app_id == payload.app_id)

        existing = db.session.scalar(select(GitHubConnection).where(*filters).limit(1))
        if existing:
            raise BadRequest("Connection already exists for this repository")

        # Retrieve OAuth token from Redis if oauth_state is provided
        access_token = None
        refresh_token = None
        token_expires_at = None

        if payload.oauth_state:
            import json
            from datetime import datetime

            from extensions.ext_redis import redis_client

            oauth_token_key = f"github_oauth_token:{payload.oauth_state}"
            token_data_json = redis_client.get(oauth_token_key)

            if token_data_json:
                token_data = json.loads(token_data_json)
                access_token = token_data.get("access_token")
                refresh_token = token_data.get("refresh_token")

                if token_data.get("token_expires_at"):
                    token_expires_at = datetime.fromisoformat(token_data["token_expires_at"])

                # Verify tenant_id and user_id match
                if token_data.get("tenant_id") != tenant or token_data.get("user_id") != _account.id:
                    raise BadRequest("OAuth token does not match current user")

                # Delete token from Redis after use
                redis_client.delete(oauth_token_key)
            else:
                raise BadRequest("OAuth token expired or not found. Please reconnect to GitHub.")

        # Create new connection with repository info
        # Auto-generate workflow file path: workflows/{app_id}.json if app_id exists, else workflow.json
        workflow_file_path = f"workflows/{payload.app_id}.json" if payload.app_id else "workflow.json"

        connection = GitHubConnection(
            tenant_id=tenant,
            user_id=_account.id,
            app_id=payload.app_id,
            repository_owner=payload.repository_owner,
            repository_name=payload.repository_name,
            branch=payload.branch,
            workflow_file_path=workflow_file_path,
        )

        # Set encrypted tokens if we have them from OAuth
        if access_token:
            connection.set_encrypted_access_token(access_token)
            if refresh_token:
                connection.set_encrypted_refresh_token(refresh_token)
            connection.token_expires_at = token_expires_at
        else:
            # If no OAuth token, this is an update to existing connection
            # Find existing connection without repository
            existing_connection = (
                db.session.query(GitHubConnection)
                .where(
                    GitHubConnection.tenant_id == tenant,
                    GitHubConnection.user_id == _account.id,
                    GitHubConnection.app_id == payload.app_id,
                    GitHubConnection.repository_name == "",
                )
                .first()
            )

            if not existing_connection:
                raise NotFound("No pending OAuth connection found. Please complete OAuth flow first.")

            # Update existing connection
            connection = existing_connection
            connection.repository_owner = payload.repository_owner
            connection.repository_name = payload.repository_name
            connection.branch = payload.branch
            connection.workflow_file_path = workflow_file_path

        db.session.add(connection)
        db.session.commit()

        logger.info(
            "GitHub connection created: connection_id=%s, repository=%s/%s",
            connection.id,
            payload.repository_owner,
            payload.repository_name,
        )

        return {"data": connection.to_dict(include_tokens=False)}, 201


@console_ns.route("/github/connections/<connection_id>")
class GitHubConnectionDetail(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("get_github_connection")
    def get(self, connection_id: str):
        """Get GitHub connection details."""
        _account, tenant = current_account_with_tenant()

        connection = db.session.get(GitHubConnection, connection_id)
        if not connection or connection.tenant_id != tenant:
            raise NotFound("GitHub connection not found")

        return {"data": connection.to_dict(include_tokens=False)}

    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("update_github_connection")
    def patch(self, connection_id: str):
        """Update GitHub connection."""
        _account, tenant = current_account_with_tenant()

        connection = db.session.get(GitHubConnection, connection_id)
        if not connection or connection.tenant_id != tenant:
            raise NotFound("GitHub connection not found")

        payload = GitHubConnectionUpdatePayload.model_validate(request.json)

        # Check if updating to a repository that already exists (excluding current connection)
        if payload.repository_owner and payload.repository_name:
            filters = [
                GitHubConnection.tenant_id == tenant,
                GitHubConnection.repository_owner == payload.repository_owner,
                GitHubConnection.repository_name == payload.repository_name,
                GitHubConnection.id != connection_id,  # Exclude current connection
            ]
            if connection.app_id:
                filters.append(GitHubConnection.app_id == connection.app_id)

            existing = db.session.scalar(select(GitHubConnection).where(*filters).limit(1))
            if existing:
                raise BadRequest("Connection already exists for this repository")

        if payload.repository_owner:
            connection.repository_owner = payload.repository_owner
        if payload.repository_name:
            connection.repository_name = payload.repository_name
        if payload.branch:
            connection.branch = payload.branch
        if payload.workflow_file_path:
            connection.workflow_file_path = payload.workflow_file_path

        db.session.commit()

        return {"data": connection.to_dict(include_tokens=False)}

    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("delete_github_connection")
    def delete(self, connection_id: str):
        """Delete GitHub connection."""
        _account, tenant = current_account_with_tenant()

        from services.github.github_oauth_service import GitHubOAuthService

        try:
            GitHubOAuthService.revoke_connection(connection_id, tenant)
            return {"result": "success"}, 200
        except ValueError as e:
            raise NotFound(str(e)) from e


@console_ns.route("/github/connections/<connection_id>/repositories")
class GitHubConnectionRepositories(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("list_github_repositories")
    def get(self, connection_id: str):
        """List repositories accessible to the connection."""
        _account, tenant = current_account_with_tenant()

        connection = db.session.get(GitHubConnection, connection_id)
        if not connection or connection.tenant_id != tenant:
            raise NotFound("GitHub connection not found")

        if not connection.repository_owner:
            raise BadRequest("Connection not fully configured. Please complete OAuth flow.")

        try:
            client = GitHubAPIClient(connection)
            repositories = client.list_repositories()
            return {"data": repositories}
        except Exception as e:
            logger.exception("Failed to list GitHub repositories")
            raise BadRequest(f"Failed to list repositories: {str(e)}") from e


@console_ns.route("/github/connections/<connection_id>/branches")
class GitHubConnectionBranches(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("list_github_branches")
    def get(self, connection_id: str):
        """List branches in the repository."""
        _account, tenant = current_account_with_tenant()

        connection = db.session.get(GitHubConnection, connection_id)
        if not connection or connection.tenant_id != tenant:
            raise NotFound("GitHub connection not found")

        if not connection.repository_name:
            raise BadRequest("Repository not configured")

        try:
            client = GitHubAPIClient(connection)
            branches = client.list_branches()
            return {"data": branches}
        except Exception as e:
            logger.exception("Failed to list GitHub branches")
            raise BadRequest(f"Failed to list branches: {str(e)}") from e


@console_ns.route("/github/oauth/repositories")
class GitHubOAuthRepositories(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("list_github_repositories_from_oauth")
    def get(self):
        """List repositories using OAuth token from Redis (before connection is created)."""
        account, tenant = current_account_with_tenant()

        oauth_state = request.args.get("oauth_state")
        if not oauth_state:
            raise BadRequest("oauth_state is required")

        # Retrieve OAuth token from Redis
        import json

        from extensions.ext_redis import redis_client

        oauth_token_key = f"github_oauth_token:{oauth_state}"
        token_data_json = redis_client.get(oauth_token_key)

        if not token_data_json:
            raise BadRequest("OAuth token expired or not found. Please reconnect to GitHub.")

        token_data = json.loads(token_data_json)

        # Verify tenant_id and user_id match
        if token_data.get("tenant_id") != tenant or token_data.get("user_id") != account.id:
            raise BadRequest("OAuth token does not match current user")

        access_token = token_data.get("access_token")
        if not access_token:
            raise BadRequest("Invalid OAuth token data")

        try:
            # Create a temporary connection object just for API client
            from dataclasses import dataclass

            @dataclass
            class TempConnection:
                tenant_id: str
                access_token: str

                def get_decrypted_access_token(self):
                    return self.access_token

            temp_conn = TempConnection(tenant_id=tenant, access_token=access_token)
            client = GitHubAPIClient(temp_conn)
            repositories = client.list_repositories()
            return {"data": repositories}
        except Exception as e:
            logger.exception("Failed to list GitHub repositories from OAuth token")
            raise BadRequest(f"Failed to list repositories: {str(e)}") from e
