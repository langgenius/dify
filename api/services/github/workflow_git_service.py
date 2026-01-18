import base64
import json
import logging
from typing import Any

from models import App
from models.github_connection import GitHubConnection
from models.workflow import Workflow
from services.github.github_api_client import GitHubAPIClient
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)


class WorkflowGitService:
    """
    Service for Git operations on workflows.
    """

    def __init__(self, connection: GitHubConnection):
        """
        Initialize WorkflowGitService with GitHub connection.
        
        Args:
            connection: GitHubConnection instance
        """
        self.connection = connection
        self.github_client = GitHubAPIClient(connection)
        self.workflow_service = WorkflowService()

    def serialize_workflow(self, workflow: Workflow, include_secret: bool = False) -> str:
        """
        Serialize workflow to JSON string.
        
        Args:
            workflow: Workflow instance
            include_secret: Whether to include secret values
            
        Returns:
            JSON string representation of workflow
        """
        workflow_dict = workflow.to_dict(include_secret=include_secret)
        
        # Add metadata
        workflow_dict["metadata"] = {
            "workflow_id": workflow.id,
            "app_id": workflow.app_id,
            "version": workflow.version,
            "type": workflow.type,
            "created_at": workflow.created_at.isoformat() if workflow.created_at else None,
            "updated_at": workflow.updated_at.isoformat() if workflow.updated_at else None,
            "created_by": workflow.created_by,
            "updated_by": workflow.updated_by,
        }
        
        return json.dumps(workflow_dict, indent=2, ensure_ascii=False)

    def push_workflow(
        self,
        workflow: Workflow,
        commit_message: str | None = None,
        branch: str | None = None,
        include_secret: bool = False,
        create_branch: bool = True,
    ) -> dict[str, Any]:
        """
        Push workflow to GitHub repository.
        
        Args:
            workflow: Workflow instance to push
            commit_message: Custom commit message (defaults to auto-generated)
            branch: Branch name (defaults to connection's branch)
            include_secret: Whether to include secret values
            create_branch: Whether to create branch if it doesn't exist (default: True)
            
        Returns:
            Commit information from GitHub
        """
        branch = branch or self.connection.branch
        
        # Check if branch exists, create if needed
        if create_branch:
            try:
                self.github_client.get_branch(branch)
            except ValueError:
                # Branch doesn't exist, create it from default branch
                logger.info("Branch '%s' doesn't exist, creating from '%s'", branch, self.connection.branch)
                try:
                    self.github_client.create_branch(branch, from_branch=self.connection.branch)
                    logger.info("Created branch '%s'", branch)
                except ValueError as e:
                    # If default branch doesn't exist, try 'main'
                    if self.connection.branch != "main":
                        try:
                            self.github_client.create_branch(branch, from_branch="main")
                            logger.info("Created branch '%s' from 'main'", branch)
                        except ValueError:
                            raise ValueError(f"Failed to create branch '{branch}': {str(e)}") from e
                    else:
                        raise ValueError(f"Failed to create branch '{branch}': {str(e)}") from e
        
        # Serialize workflow
        workflow_json = self.serialize_workflow(workflow, include_secret=include_secret)
        
        # Encode to base64 (GitHub API requirement)
        workflow_base64 = base64.b64encode(workflow_json.encode("utf-8")).decode("utf-8")
        
        # Generate commit message if not provided
        if not commit_message:
            commit_message = f"Update workflow: {workflow.id}"
            if workflow.version != Workflow.VERSION_DRAFT:
                commit_message += f" (version: {workflow.version})"
        
        # Get workflow file path from connection
        workflow_file_path = self.connection.workflow_file_path or "workflow.json"
        
        # Check if file exists to get SHA for update
        file_sha = None
        try:
            existing_file = self.github_client.get_file_content(workflow_file_path, branch=branch)
            file_sha = existing_file.get("sha")
        except ValueError:
            # File doesn't exist, will create new file
            pass
        
        # Create or update file
        result = self.github_client.create_or_update_file(
            path=workflow_file_path,
            content=workflow_base64,
            message=commit_message,
            branch=branch,
            sha=file_sha,
        )
        
        logger.info(
            "Workflow pushed to GitHub: workflow_id=%s, branch=%s, commit=%s",
            workflow.id,
            branch,
            result.get("commit", {}).get("sha"),
        )
        
        return result

    def pull_workflow(
        self,
        app: App,
        branch: str | None = None,
        workflow_id: str | None = None,
    ) -> Workflow:
        """
        Pull workflow from GitHub repository and update local workflow.
        
        Args:
            app: App instance
            branch: Branch name (defaults to connection's branch)
            workflow_id: Specific workflow ID to update (defaults to draft workflow)
            
        Returns:
            Updated Workflow instance
        """
        branch = branch or self.connection.branch
        
        # Get workflow file path from connection
        workflow_file_path = self.connection.workflow_file_path or "workflow.json"
        
        # Get workflow file from GitHub
        file_content = self.github_client.get_file_content(workflow_file_path, branch=branch)
        
        # Decode base64 content
        if file_content.get("encoding") == "base64":
            workflow_json = base64.b64decode(file_content["content"]).decode("utf-8")
        else:
            # Handle non-base64 content (shouldn't happen with GitHub API)
            workflow_json = file_content.get("content", "")
        
        # Parse workflow data
        workflow_data = json.loads(workflow_json)
        
        # Get workflow to update
        if workflow_id:
            workflow = self.workflow_service.get_published_workflow_by_id(app, workflow_id)
            if not workflow:
                raise ValueError(f"Workflow not found: {workflow_id}")
        else:
            # Update draft workflow
            workflow = self.workflow_service.get_draft_workflow(app)
            if not workflow:
                raise ValueError("Draft workflow not found")
        
        # Update workflow with pulled data
        workflow.graph = json.dumps(workflow_data.get("graph", {}))
        workflow._features = json.dumps(workflow_data.get("features", {}))
        
        # Update environment variables
        if "environment_variables" in workflow_data:
            from factories import variable_factory
            
            env_vars = [
                variable_factory.build_environment_variable_from_mapping(v)
                for v in workflow_data["environment_variables"]
            ]
            workflow.environment_variables = env_vars
        
        # Update conversation variables
        if "conversation_variables" in workflow_data:
            from factories import variable_factory
            
            conv_vars = [
                variable_factory.build_conversation_variable_from_mapping(v)
                for v in workflow_data["conversation_variables"]
            ]
            workflow.conversation_variables = conv_vars
        
        # Update RAG pipeline variables if present
        if "rag_pipeline_variables" in workflow_data:
            workflow.rag_pipeline_variables = workflow_data["rag_pipeline_variables"]
        
        from extensions.ext_database import db
        
        db.session.commit()
        
        logger.info(
            "Workflow pulled from GitHub: workflow_id=%s, branch=%s",
            workflow.id,
            branch,
        )
        
        return workflow

    def get_workflow_commit_history(self, branch: str | None = None, limit: int = 30) -> list[dict[str, Any]]:
        """
        Get commit history for workflow file.
        
        Args:
            branch: Branch name (defaults to connection's branch)
            limit: Maximum number of commits to return
            
        Returns:
            List of commit information
        """
        branch = branch or self.connection.branch
        
        # Get workflow file path from connection
        workflow_file_path = self.connection.workflow_file_path or "workflow.json"
        
        # Get commits for the workflow file
        endpoint = f"/repos/{self.connection.repository_full_name}/commits"
        params = {
            "sha": branch,
            "path": workflow_file_path,
            "per_page": min(limit, 100),
        }
        
        return self.github_client._request("GET", endpoint, params=params)

