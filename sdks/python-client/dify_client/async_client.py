"""Asynchronous Dify API client.

This module provides async/await support for all Dify API operations using httpx.AsyncClient.
All client classes mirror their synchronous counterparts but require `await` for method calls.

Example:
    import asyncio
    from dify_client import AsyncChatClient

    async def main():
        async with AsyncChatClient(api_key="your-key") as client:
            response = await client.create_chat_message(
                inputs={},
                query="Hello",
                user="user-123"
            )
            print(response.json())

    asyncio.run(main())
"""

import json
import os
from typing import Literal, Dict, List, Any, IO, Optional, Union

import aiofiles
import httpx


class AsyncDifyClient:
    """Asynchronous Dify API client.

    This client uses httpx.AsyncClient for efficient async connection pooling.
    It's recommended to use this client as a context manager:

    Example:
        async with AsyncDifyClient(api_key="your-key") as client:
            response = await client.get_app_info()
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.dify.ai/v1",
        timeout: float = 60.0,
    ):
        """Initialize the async Dify client.

        Args:
            api_key: Your Dify API key
            base_url: Base URL for the Dify API
            timeout: Request timeout in seconds (default: 60.0)
        """
        self.api_key = api_key
        self.base_url = base_url
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(timeout, connect=5.0),
        )

    async def __aenter__(self):
        """Support async context manager protocol."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Clean up resources when exiting async context."""
        await self.aclose()

    async def aclose(self):
        """Close the async HTTP client and release resources."""
        if hasattr(self, "_client"):
            await self._client.aclose()

    async def _send_request(
        self,
        method: str,
        endpoint: str,
        json: Dict | None = None,
        params: Dict | None = None,
        stream: bool = False,
        **kwargs,
    ):
        """Send an async HTTP request to the Dify API.

        Args:
            method: HTTP method (GET, POST, PUT, PATCH, DELETE)
            endpoint: API endpoint path
            json: JSON request body
            params: Query parameters
            stream: Whether to stream the response
            **kwargs: Additional arguments to pass to httpx.request

        Returns:
            httpx.Response object
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        response = await self._client.request(
            method,
            endpoint,
            json=json,
            params=params,
            headers=headers,
            **kwargs,
        )

        return response

    async def _send_request_with_files(self, method: str, endpoint: str, data: dict, files: dict):
        """Send an async HTTP request with file uploads.

        Args:
            method: HTTP method (POST, PUT, etc.)
            endpoint: API endpoint path
            data: Form data
            files: Files to upload

        Returns:
            httpx.Response object
        """
        headers = {"Authorization": f"Bearer {self.api_key}"}

        response = await self._client.request(
            method,
            endpoint,
            data=data,
            headers=headers,
            files=files,
        )

        return response

    async def message_feedback(self, message_id: str, rating: Literal["like", "dislike"], user: str):
        """Send feedback for a message."""
        data = {"rating": rating, "user": user}
        return await self._send_request("POST", f"/messages/{message_id}/feedbacks", data)

    async def get_application_parameters(self, user: str):
        """Get application parameters."""
        params = {"user": user}
        return await self._send_request("GET", "/parameters", params=params)

    async def file_upload(self, user: str, files: dict):
        """Upload a file."""
        data = {"user": user}
        return await self._send_request_with_files("POST", "/files/upload", data=data, files=files)

    async def text_to_audio(self, text: str, user: str, streaming: bool = False):
        """Convert text to audio."""
        data = {"text": text, "user": user, "streaming": streaming}
        return await self._send_request("POST", "/text-to-audio", json=data)

    async def get_meta(self, user: str):
        """Get metadata."""
        params = {"user": user}
        return await self._send_request("GET", "/meta", params=params)

    async def get_app_info(self):
        """Get basic application information including name, description, tags, and mode."""
        return await self._send_request("GET", "/info")

    async def get_app_site_info(self):
        """Get application site information."""
        return await self._send_request("GET", "/site")

    async def get_file_preview(self, file_id: str):
        """Get file preview by file ID."""
        return await self._send_request("GET", f"/files/{file_id}/preview")

    # App Configuration APIs
    async def get_app_site_config(self, app_id: str):
        """Get app site configuration.

        Args:
            app_id: ID of the app

        Returns:
            App site configuration
        """
        url = f"/apps/{app_id}/site/config"
        return await self._send_request("GET", url)

    async def update_app_site_config(self, app_id: str, config_data: Dict[str, Any]):
        """Update app site configuration.

        Args:
            app_id: ID of the app
            config_data: Configuration data to update

        Returns:
            Updated app site configuration
        """
        url = f"/apps/{app_id}/site/config"
        return await self._send_request("PUT", url, json=config_data)

    async def get_app_api_tokens(self, app_id: str):
        """Get API tokens for an app.

        Args:
            app_id: ID of the app

        Returns:
            List of API tokens
        """
        url = f"/apps/{app_id}/api-tokens"
        return await self._send_request("GET", url)

    async def create_app_api_token(self, app_id: str, name: str, description: str | None = None):
        """Create a new API token for an app.

        Args:
            app_id: ID of the app
            name: Name for the API token
            description: Description for the API token (optional)

        Returns:
            Created API token information
        """
        data = {"name": name, "description": description}
        url = f"/apps/{app_id}/api-tokens"
        return await self._send_request("POST", url, json=data)

    async def delete_app_api_token(self, app_id: str, token_id: str):
        """Delete an API token.

        Args:
            app_id: ID of the app
            token_id: ID of the token to delete

        Returns:
            Deletion result
        """
        url = f"/apps/{app_id}/api-tokens/{token_id}"
        return await self._send_request("DELETE", url)


class AsyncCompletionClient(AsyncDifyClient):
    """Async client for Completion API operations."""

    async def create_completion_message(
        self,
        inputs: dict,
        response_mode: Literal["blocking", "streaming"],
        user: str,
        files: Dict | None = None,
    ):
        """Create a completion message.

        Args:
            inputs: Input variables for the completion
            response_mode: Response mode ('blocking' or 'streaming')
            user: User identifier
            files: Optional files to include

        Returns:
            httpx.Response object
        """
        data = {
            "inputs": inputs,
            "response_mode": response_mode,
            "user": user,
            "files": files,
        }
        return await self._send_request(
            "POST",
            "/completion-messages",
            data,
            stream=(response_mode == "streaming"),
        )


class AsyncChatClient(AsyncDifyClient):
    """Async client for Chat API operations."""

    async def create_chat_message(
        self,
        inputs: dict,
        query: str,
        user: str,
        response_mode: Literal["blocking", "streaming"] = "blocking",
        conversation_id: str | None = None,
        files: Dict | None = None,
    ):
        """Create a chat message.

        Args:
            inputs: Input variables for the chat
            query: User query/message
            user: User identifier
            response_mode: Response mode ('blocking' or 'streaming')
            conversation_id: Optional conversation ID for context
            files: Optional files to include

        Returns:
            httpx.Response object
        """
        data = {
            "inputs": inputs,
            "query": query,
            "user": user,
            "response_mode": response_mode,
            "files": files,
        }
        if conversation_id:
            data["conversation_id"] = conversation_id

        return await self._send_request(
            "POST",
            "/chat-messages",
            data,
            stream=(response_mode == "streaming"),
        )

    async def get_suggested(self, message_id: str, user: str):
        """Get suggested questions for a message."""
        params = {"user": user}
        return await self._send_request("GET", f"/messages/{message_id}/suggested", params=params)

    async def stop_message(self, task_id: str, user: str):
        """Stop a running message generation."""
        data = {"user": user}
        return await self._send_request("POST", f"/chat-messages/{task_id}/stop", data)

    async def get_conversations(
        self,
        user: str,
        last_id: str | None = None,
        limit: int | None = None,
        pinned: bool | None = None,
    ):
        """Get list of conversations."""
        params = {"user": user, "last_id": last_id, "limit": limit, "pinned": pinned}
        return await self._send_request("GET", "/conversations", params=params)

    async def get_conversation_messages(
        self,
        user: str,
        conversation_id: str | None = None,
        first_id: str | None = None,
        limit: int | None = None,
    ):
        """Get messages from a conversation."""
        params = {
            "user": user,
            "conversation_id": conversation_id,
            "first_id": first_id,
            "limit": limit,
        }
        return await self._send_request("GET", "/messages", params=params)

    async def rename_conversation(self, conversation_id: str, name: str, auto_generate: bool, user: str):
        """Rename a conversation."""
        data = {"name": name, "auto_generate": auto_generate, "user": user}
        return await self._send_request("POST", f"/conversations/{conversation_id}/name", data)

    async def delete_conversation(self, conversation_id: str, user: str):
        """Delete a conversation."""
        data = {"user": user}
        return await self._send_request("DELETE", f"/conversations/{conversation_id}", data)

    async def audio_to_text(self, audio_file: Union[IO[bytes], tuple], user: str):
        """Convert audio to text."""
        data = {"user": user}
        files = {"file": audio_file}
        return await self._send_request_with_files("POST", "/audio-to-text", data, files)

    # Annotation APIs
    async def annotation_reply_action(
        self,
        action: Literal["enable", "disable"],
        score_threshold: float,
        embedding_provider_name: str,
        embedding_model_name: str,
    ):
        """Enable or disable annotation reply feature."""
        data = {
            "score_threshold": score_threshold,
            "embedding_provider_name": embedding_provider_name,
            "embedding_model_name": embedding_model_name,
        }
        return await self._send_request("POST", f"/apps/annotation-reply/{action}", json=data)

    async def get_annotation_reply_status(self, action: Literal["enable", "disable"], job_id: str):
        """Get the status of an annotation reply action job."""
        return await self._send_request("GET", f"/apps/annotation-reply/{action}/status/{job_id}")

    async def list_annotations(self, page: int = 1, limit: int = 20, keyword: str | None = None):
        """List annotations for the application."""
        params = {"page": page, "limit": limit, "keyword": keyword}
        return await self._send_request("GET", "/apps/annotations", params=params)

    async def create_annotation(self, question: str, answer: str):
        """Create a new annotation."""
        data = {"question": question, "answer": answer}
        return await self._send_request("POST", "/apps/annotations", json=data)

    async def update_annotation(self, annotation_id: str, question: str, answer: str):
        """Update an existing annotation."""
        data = {"question": question, "answer": answer}
        return await self._send_request("PUT", f"/apps/annotations/{annotation_id}", json=data)

    async def delete_annotation(self, annotation_id: str):
        """Delete an annotation."""
        return await self._send_request("DELETE", f"/apps/annotations/{annotation_id}")

    # Enhanced Annotation APIs
    async def get_annotation_reply_job_status(self, action: str, job_id: str):
        """Get status of an annotation reply action job."""
        url = f"/apps/annotation-reply/{action}/status/{job_id}"
        return await self._send_request("GET", url)

    async def list_annotations_with_pagination(self, page: int = 1, limit: int = 20, keyword: str | None = None):
        """List annotations for application with pagination."""
        params = {"page": page, "limit": limit}
        if keyword:
            params["keyword"] = keyword
        return await self._send_request("GET", "/apps/annotations", params=params)

    async def create_annotation_with_response(self, question: str, answer: str):
        """Create a new annotation with full response handling."""
        data = {"question": question, "answer": answer}
        return await self._send_request("POST", "/apps/annotations", json=data)

    async def update_annotation_with_response(self, annotation_id: str, question: str, answer: str):
        """Update an existing annotation with full response handling."""
        data = {"question": question, "answer": answer}
        url = f"/apps/annotations/{annotation_id}"
        return await self._send_request("PUT", url, json=data)

    async def delete_annotation_with_response(self, annotation_id: str):
        """Delete an annotation with full response handling."""
        url = f"/apps/annotations/{annotation_id}"
        return await self._send_request("DELETE", url)

    # Conversation Variables APIs
    async def get_conversation_variables(self, conversation_id: str, user: str):
        """Get all variables for a specific conversation.

        Args:
            conversation_id: The conversation ID to query variables for
            user: User identifier

        Returns:
            Response from the API containing:
            - variables: List of conversation variables with their values
            - conversation_id: The conversation ID
        """
        params = {"user": user}
        url = f"/conversations/{conversation_id}/variables"
        return await self._send_request("GET", url, params=params)

    async def update_conversation_variable(self, conversation_id: str, variable_id: str, value: Any, user: str):
        """Update a specific conversation variable.

        Args:
            conversation_id: The conversation ID
            variable_id: The variable ID to update
            value: New value for the variable
            user: User identifier

        Returns:
            Response from the API with updated variable information
        """
        data = {"value": value, "user": user}
        url = f"/conversations/{conversation_id}/variables/{variable_id}"
        return await self._send_request("PATCH", url, json=data)

    # Enhanced Conversation Variable APIs
    async def list_conversation_variables_with_pagination(
        self, conversation_id: str, user: str, page: int = 1, limit: int = 20
    ):
        """List conversation variables with pagination."""
        params = {"page": page, "limit": limit, "user": user}
        url = f"/conversations/{conversation_id}/variables"
        return await self._send_request("GET", url, params=params)

    async def update_conversation_variable_with_response(
        self, conversation_id: str, variable_id: str, user: str, value: Any
    ):
        """Update a conversation variable with full response handling."""
        data = {"value": value, "user": user}
        url = f"/conversations/{conversation_id}/variables/{variable_id}"
        return await self._send_request("PUT", url, data=data)

    # Additional annotation methods for API parity
    async def get_annotation_reply_job_status(self, action: str, job_id: str):
        """Get status of an annotation reply action job."""
        url = f"/apps/annotation-reply/{action}/status/{job_id}"
        return await self._send_request("GET", url)

    async def list_annotations_with_pagination(self, page: int = 1, limit: int = 20, keyword: str | None = None):
        """List annotations for application with pagination."""
        params = {"page": page, "limit": limit}
        if keyword:
            params["keyword"] = keyword
        return await self._send_request("GET", "/apps/annotations", params=params)

    async def create_annotation_with_response(self, question: str, answer: str):
        """Create a new annotation with full response handling."""
        data = {"question": question, "answer": answer}
        return await self._send_request("POST", "/apps/annotations", json=data)

    async def update_annotation_with_response(self, annotation_id: str, question: str, answer: str):
        """Update an existing annotation with full response handling."""
        data = {"question": question, "answer": answer}
        url = f"/apps/annotations/{annotation_id}"
        return await self._send_request("PUT", url, json=data)

    async def delete_annotation_with_response(self, annotation_id: str):
        """Delete an annotation with full response handling."""
        url = f"/apps/annotations/{annotation_id}"
        return await self._send_request("DELETE", url)


class AsyncWorkflowClient(AsyncDifyClient):
    """Async client for Workflow API operations."""

    async def run(
        self,
        inputs: dict,
        response_mode: Literal["blocking", "streaming"] = "streaming",
        user: str = "abc-123",
    ):
        """Run a workflow."""
        data = {"inputs": inputs, "response_mode": response_mode, "user": user}
        return await self._send_request("POST", "/workflows/run", data)

    async def stop(self, task_id: str, user: str):
        """Stop a running workflow task."""
        data = {"user": user}
        return await self._send_request("POST", f"/workflows/tasks/{task_id}/stop", data)

    async def get_result(self, workflow_run_id: str):
        """Get workflow run result."""
        return await self._send_request("GET", f"/workflows/run/{workflow_run_id}")

    async def get_workflow_logs(
        self,
        keyword: str = None,
        status: Literal["succeeded", "failed", "stopped"] | None = None,
        page: int = 1,
        limit: int = 20,
        created_at__before: str = None,
        created_at__after: str = None,
        created_by_end_user_session_id: str = None,
        created_by_account: str = None,
    ):
        """Get workflow execution logs with optional filtering."""
        params = {
            "page": page,
            "limit": limit,
            "keyword": keyword,
            "status": status,
            "created_at__before": created_at__before,
            "created_at__after": created_at__after,
            "created_by_end_user_session_id": created_by_end_user_session_id,
            "created_by_account": created_by_account,
        }
        return await self._send_request("GET", "/workflows/logs", params=params)

    async def run_specific_workflow(
        self,
        workflow_id: str,
        inputs: dict,
        response_mode: Literal["blocking", "streaming"] = "streaming",
        user: str = "abc-123",
    ):
        """Run a specific workflow by workflow ID."""
        data = {"inputs": inputs, "response_mode": response_mode, "user": user}
        return await self._send_request(
            "POST",
            f"/workflows/{workflow_id}/run",
            data,
            stream=(response_mode == "streaming"),
        )

    # Enhanced Workflow APIs
    async def get_workflow_draft(self, app_id: str):
        """Get workflow draft configuration.

        Args:
            app_id: ID of the workflow app

        Returns:
            Workflow draft configuration
        """
        url = f"/apps/{app_id}/workflow/draft"
        return await self._send_request("GET", url)

    async def update_workflow_draft(self, app_id: str, workflow_data: Dict[str, Any]):
        """Update workflow draft configuration.

        Args:
            app_id: ID of the workflow app
            workflow_data: Workflow configuration data

        Returns:
            Updated workflow draft
        """
        url = f"/apps/{app_id}/workflow/draft"
        return await self._send_request("PUT", url, json=workflow_data)

    async def publish_workflow(self, app_id: str):
        """Publish workflow from draft.

        Args:
            app_id: ID of the workflow app

        Returns:
            Published workflow information
        """
        url = f"/apps/{app_id}/workflow/publish"
        return await self._send_request("POST", url)

    async def get_workflow_run_history(
        self,
        app_id: str,
        page: int = 1,
        limit: int = 20,
        status: Literal["succeeded", "failed", "stopped"] | None = None,
    ):
        """Get workflow run history.

        Args:
            app_id: ID of the workflow app
            page: Page number (default: 1)
            limit: Number of items per page (default: 20)
            status: Filter by status (optional)

        Returns:
            Paginated workflow run history
        """
        params = {"page": page, "limit": limit}
        if status:
            params["status"] = status
        url = f"/apps/{app_id}/workflow/runs"
        return await self._send_request("GET", url, params=params)


class AsyncWorkspaceClient(AsyncDifyClient):
    """Async client for workspace-related operations."""

    async def get_available_models(self, model_type: str):
        """Get available models by model type."""
        url = f"/workspaces/current/models/model-types/{model_type}"
        return await self._send_request("GET", url)

    async def get_available_models_by_type(self, model_type: str):
        """Get available models by model type (enhanced version)."""
        url = f"/workspaces/current/models/model-types/{model_type}"
        return await self._send_request("GET", url)

    async def get_model_providers(self):
        """Get all model providers."""
        return await self._send_request("GET", "/workspaces/current/model-providers")

    async def get_model_provider_models(self, provider_name: str):
        """Get models for a specific provider."""
        url = f"/workspaces/current/model-providers/{provider_name}/models"
        return await self._send_request("GET", url)

    async def validate_model_provider_credentials(self, provider_name: str, credentials: Dict[str, Any]):
        """Validate model provider credentials."""
        url = f"/workspaces/current/model-providers/{provider_name}/credentials/validate"
        return await self._send_request("POST", url, json=credentials)

    # File Management APIs
    async def get_file_info(self, file_id: str):
        """Get information about a specific file."""
        url = f"/files/{file_id}/info"
        return await self._send_request("GET", url)

    async def get_file_download_url(self, file_id: str):
        """Get download URL for a file."""
        url = f"/files/{file_id}/download-url"
        return await self._send_request("GET", url)

    async def delete_file(self, file_id: str):
        """Delete a file."""
        url = f"/files/{file_id}"
        return await self._send_request("DELETE", url)


class AsyncKnowledgeBaseClient(AsyncDifyClient):
    """Async client for Knowledge Base API operations."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.dify.ai/v1",
        dataset_id: str | None = None,
        timeout: float = 60.0,
    ):
        """Construct an AsyncKnowledgeBaseClient object.

        Args:
            api_key: API key of Dify
            base_url: Base URL of Dify API
            dataset_id: ID of the dataset
            timeout: Request timeout in seconds
        """
        super().__init__(api_key=api_key, base_url=base_url, timeout=timeout)
        self.dataset_id = dataset_id

    def _get_dataset_id(self):
        """Get the dataset ID, raise error if not set."""
        if self.dataset_id is None:
            raise ValueError("dataset_id is not set")
        return self.dataset_id

    async def create_dataset(self, name: str, **kwargs):
        """Create a new dataset."""
        return await self._send_request("POST", "/datasets", {"name": name}, **kwargs)

    async def list_datasets(self, page: int = 1, page_size: int = 20, **kwargs):
        """List all datasets."""
        return await self._send_request("GET", "/datasets", params={"page": page, "limit": page_size}, **kwargs)

    async def create_document_by_text(self, name: str, text: str, extra_params: Dict | None = None, **kwargs):
        """Create a document by text.

        Args:
            name: Name of the document
            text: Text content of the document
            extra_params: Extra parameters for the API

        Returns:
            Response from the API
        """
        data = {
            "indexing_technique": "high_quality",
            "process_rule": {"mode": "automatic"},
            "name": name,
            "text": text,
        }
        if extra_params is not None and isinstance(extra_params, dict):
            data.update(extra_params)
        url = f"/datasets/{self._get_dataset_id()}/document/create_by_text"
        return await self._send_request("POST", url, json=data, **kwargs)

    async def update_document_by_text(
        self,
        document_id: str,
        name: str,
        text: str,
        extra_params: Dict | None = None,
        **kwargs,
    ):
        """Update a document by text."""
        data = {"name": name, "text": text}
        if extra_params is not None and isinstance(extra_params, dict):
            data.update(extra_params)
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/update_by_text"
        return await self._send_request("POST", url, json=data, **kwargs)

    async def create_document_by_file(
        self,
        file_path: str,
        original_document_id: str | None = None,
        extra_params: Dict | None = None,
    ):
        """Create a document by file."""
        async with aiofiles.open(file_path, "rb") as f:
            files = {"file": (os.path.basename(file_path), f)}
            data = {
                "process_rule": {"mode": "automatic"},
                "indexing_technique": "high_quality",
            }
            if extra_params is not None and isinstance(extra_params, dict):
                data.update(extra_params)
            if original_document_id is not None:
                data["original_document_id"] = original_document_id
            url = f"/datasets/{self._get_dataset_id()}/document/create_by_file"
            return await self._send_request_with_files("POST", url, {"data": json.dumps(data)}, files)

    async def update_document_by_file(self, document_id: str, file_path: str, extra_params: Dict | None = None):
        """Update a document by file."""
        async with aiofiles.open(file_path, "rb") as f:
            files = {"file": (os.path.basename(file_path), f)}
            data = {}
            if extra_params is not None and isinstance(extra_params, dict):
                data.update(extra_params)
            url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/update_by_file"
            return await self._send_request_with_files("POST", url, {"data": json.dumps(data)}, files)

    async def batch_indexing_status(self, batch_id: str, **kwargs):
        """Get the status of the batch indexing."""
        url = f"/datasets/{self._get_dataset_id()}/documents/{batch_id}/indexing-status"
        return await self._send_request("GET", url, **kwargs)

    async def delete_dataset(self):
        """Delete this dataset."""
        url = f"/datasets/{self._get_dataset_id()}"
        return await self._send_request("DELETE", url)

    async def delete_document(self, document_id: str):
        """Delete a document."""
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}"
        return await self._send_request("DELETE", url)

    async def list_documents(
        self,
        page: int | None = None,
        page_size: int | None = None,
        keyword: str | None = None,
        **kwargs,
    ):
        """Get a list of documents in this dataset."""
        params = {
            "page": page,
            "limit": page_size,
            "keyword": keyword,
        }
        url = f"/datasets/{self._get_dataset_id()}/documents"
        return await self._send_request("GET", url, params=params, **kwargs)

    async def add_segments(self, document_id: str, segments: list[dict], **kwargs):
        """Add segments to a document."""
        data = {"segments": segments}
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/segments"
        return await self._send_request("POST", url, json=data, **kwargs)

    async def query_segments(
        self,
        document_id: str,
        keyword: str | None = None,
        status: str | None = None,
        **kwargs,
    ):
        """Query segments in this document.

        Args:
            document_id: ID of the document
            keyword: Query keyword (optional)
            status: Status of the segment (optional, e.g., 'completed')
            **kwargs: Additional parameters to pass to the API.
                     Can include a 'params' dict for extra query parameters.

        Returns:
            Response from the API
        """
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/segments"
        params = {
            "keyword": keyword,
            "status": status,
        }
        if "params" in kwargs:
            params.update(kwargs.pop("params"))
        return await self._send_request("GET", url, params=params, **kwargs)

    async def delete_document_segment(self, document_id: str, segment_id: str):
        """Delete a segment from a document."""
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/segments/{segment_id}"
        return await self._send_request("DELETE", url)

    async def update_document_segment(self, document_id: str, segment_id: str, segment_data: dict, **kwargs):
        """Update a segment in a document."""
        data = {"segment": segment_data}
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/segments/{segment_id}"
        return await self._send_request("POST", url, json=data, **kwargs)

    # Advanced Knowledge Base APIs
    async def hit_testing(
        self,
        query: str,
        retrieval_model: Dict[str, Any] = None,
        external_retrieval_model: Dict[str, Any] = None,
    ):
        """Perform hit testing on the dataset."""
        data = {"query": query}
        if retrieval_model:
            data["retrieval_model"] = retrieval_model
        if external_retrieval_model:
            data["external_retrieval_model"] = external_retrieval_model
        url = f"/datasets/{self._get_dataset_id()}/hit-testing"
        return await self._send_request("POST", url, json=data)

    async def get_dataset_metadata(self):
        """Get dataset metadata."""
        url = f"/datasets/{self._get_dataset_id()}/metadata"
        return await self._send_request("GET", url)

    async def create_dataset_metadata(self, metadata_data: Dict[str, Any]):
        """Create dataset metadata."""
        url = f"/datasets/{self._get_dataset_id()}/metadata"
        return await self._send_request("POST", url, json=metadata_data)

    async def update_dataset_metadata(self, metadata_id: str, metadata_data: Dict[str, Any]):
        """Update dataset metadata."""
        url = f"/datasets/{self._get_dataset_id()}/metadata/{metadata_id}"
        return await self._send_request("PATCH", url, json=metadata_data)

    async def get_built_in_metadata(self):
        """Get built-in metadata."""
        url = f"/datasets/{self._get_dataset_id()}/metadata/built-in"
        return await self._send_request("GET", url)

    async def manage_built_in_metadata(self, action: str, metadata_data: Dict[str, Any] = None):
        """Manage built-in metadata with specified action."""
        data = metadata_data or {}
        url = f"/datasets/{self._get_dataset_id()}/metadata/built-in/{action}"
        return await self._send_request("POST", url, json=data)

    async def update_documents_metadata(self, operation_data: List[Dict[str, Any]]):
        """Update metadata for multiple documents."""
        url = f"/datasets/{self._get_dataset_id()}/documents/metadata"
        data = {"operation_data": operation_data}
        return await self._send_request("POST", url, json=data)

    # Dataset Tags APIs
    async def list_dataset_tags(self):
        """List all dataset tags."""
        return await self._send_request("GET", "/datasets/tags")

    async def bind_dataset_tags(self, tag_ids: List[str]):
        """Bind tags to dataset."""
        data = {"tag_ids": tag_ids, "target_id": self._get_dataset_id()}
        return await self._send_request("POST", "/datasets/tags/binding", json=data)

    async def unbind_dataset_tag(self, tag_id: str):
        """Unbind a single tag from dataset."""
        data = {"tag_id": tag_id, "target_id": self._get_dataset_id()}
        return await self._send_request("POST", "/datasets/tags/unbinding", json=data)

    async def get_dataset_tags(self):
        """Get tags for current dataset."""
        url = f"/datasets/{self._get_dataset_id()}/tags"
        return await self._send_request("GET", url)

    # RAG Pipeline APIs
    async def get_datasource_plugins(self, is_published: bool = True):
        """Get datasource plugins for RAG pipeline."""
        params = {"is_published": is_published}
        url = f"/datasets/{self._get_dataset_id()}/pipeline/datasource-plugins"
        return await self._send_request("GET", url, params=params)

    async def run_datasource_node(
        self,
        node_id: str,
        inputs: Dict[str, Any],
        datasource_type: str,
        is_published: bool = True,
        credential_id: str = None,
    ):
        """Run a datasource node in RAG pipeline."""
        data = {
            "inputs": inputs,
            "datasource_type": datasource_type,
            "is_published": is_published,
        }
        if credential_id:
            data["credential_id"] = credential_id
        url = f"/datasets/{self._get_dataset_id()}/pipeline/datasource/nodes/{node_id}/run"
        return await self._send_request("POST", url, json=data, stream=True)

    async def run_rag_pipeline(
        self,
        inputs: Dict[str, Any],
        datasource_type: str,
        datasource_info_list: List[Dict[str, Any]],
        start_node_id: str,
        is_published: bool = True,
        response_mode: Literal["streaming", "blocking"] = "blocking",
    ):
        """Run RAG pipeline."""
        data = {
            "inputs": inputs,
            "datasource_type": datasource_type,
            "datasource_info_list": datasource_info_list,
            "start_node_id": start_node_id,
            "is_published": is_published,
            "response_mode": response_mode,
        }
        url = f"/datasets/{self._get_dataset_id()}/pipeline/run"
        return await self._send_request("POST", url, json=data, stream=response_mode == "streaming")

    async def upload_pipeline_file(self, file_path: str):
        """Upload file for RAG pipeline."""
        async with aiofiles.open(file_path, "rb") as f:
            files = {"file": (os.path.basename(file_path), f)}
            return await self._send_request_with_files("POST", "/datasets/pipeline/file-upload", {}, files)

    # Dataset Management APIs
    async def get_dataset(self, dataset_id: str | None = None):
        """Get detailed information about a specific dataset."""
        ds_id = dataset_id or self._get_dataset_id()
        url = f"/datasets/{ds_id}"
        return await self._send_request("GET", url)

    async def update_dataset(
        self,
        dataset_id: str | None = None,
        name: str | None = None,
        description: str | None = None,
        indexing_technique: str | None = None,
        embedding_model: str | None = None,
        embedding_model_provider: str | None = None,
        retrieval_model: Dict[str, Any] | None = None,
        **kwargs,
    ):
        """Update dataset configuration.

        Args:
            dataset_id: Dataset ID (optional, uses current dataset_id if not provided)
            name: New dataset name
            description: New dataset description
            indexing_technique: Indexing technique ('high_quality' or 'economy')
            embedding_model: Embedding model name
            embedding_model_provider: Embedding model provider
            retrieval_model: Retrieval model configuration dict
            **kwargs: Additional parameters to pass to the API

        Returns:
            Response from the API with updated dataset information
        """
        ds_id = dataset_id or self._get_dataset_id()
        url = f"/datasets/{ds_id}"

        payload = {
            "name": name,
            "description": description,
            "indexing_technique": indexing_technique,
            "embedding_model": embedding_model,
            "embedding_model_provider": embedding_model_provider,
            "retrieval_model": retrieval_model,
        }

        data = {k: v for k, v in payload.items() if v is not None}
        data.update(kwargs)

        return await self._send_request("PATCH", url, json=data)

    async def batch_update_document_status(
        self,
        action: Literal["enable", "disable", "archive", "un_archive"],
        document_ids: List[str],
        dataset_id: str | None = None,
    ):
        """Batch update document status."""
        ds_id = dataset_id or self._get_dataset_id()
        url = f"/datasets/{ds_id}/documents/status/{action}"
        data = {"document_ids": document_ids}
        return await self._send_request("PATCH", url, json=data)

    # Enhanced Dataset APIs

    async def create_dataset_from_template(self, template_name: str, name: str, description: str | None = None):
        """Create a dataset from a predefined template.

        Args:
            template_name: Name of the template to use
            name: Name for the new dataset
            description: Description for the dataset (optional)

        Returns:
            Created dataset information
        """
        data = {
            "template_name": template_name,
            "name": name,
            "description": description,
        }
        return await self._send_request("POST", "/datasets/from-template", json=data)

    async def duplicate_dataset(self, dataset_id: str, name: str):
        """Duplicate an existing dataset.

        Args:
            dataset_id: ID of dataset to duplicate
            name: Name for duplicated dataset

        Returns:
            New dataset information
        """
        data = {"name": name}
        url = f"/datasets/{dataset_id}/duplicate"
        return await self._send_request("POST", url, json=data)

    async def update_conversation_variable_with_response(
        self, conversation_id: str, variable_id: str, user: str, value: Any
    ):
        """Update a conversation variable with full response handling."""
        data = {"value": value, "user": user}
        url = f"/conversations/{conversation_id}/variables/{variable_id}"
        return await self._send_request("PUT", url, json=data)

    async def list_conversation_variables_with_pagination(
        self, conversation_id: str, user: str, page: int = 1, limit: int = 20
    ):
        """List conversation variables with pagination."""
        params = {"page": page, "limit": limit, "user": user}
        url = f"/conversations/{conversation_id}/variables"
        return await self._send_request("GET", url, params=params)


class AsyncEnterpriseClient(AsyncDifyClient):
    """Async Enterprise and Account Management APIs for Dify platform administration."""

    async def get_account_info(self):
        """Get current account information."""
        return await self._send_request("GET", "/account")

    async def update_account_info(self, account_data: Dict[str, Any]):
        """Update account information."""
        return await self._send_request("PUT", "/account", json=account_data)

    # Member Management APIs
    async def list_members(self, page: int = 1, limit: int = 20, keyword: str | None = None):
        """List workspace members with pagination."""
        params = {"page": page, "limit": limit}
        if keyword:
            params["keyword"] = keyword
        return await self._send_request("GET", "/members", params=params)

    async def invite_member(self, email: str, role: str, name: str | None = None):
        """Invite a new member to the workspace."""
        data = {"email": email, "role": role}
        if name:
            data["name"] = name
        return await self._send_request("POST", "/members/invite", json=data)

    async def get_member(self, member_id: str):
        """Get detailed information about a specific member."""
        url = f"/members/{member_id}"
        return await self._send_request("GET", url)

    async def update_member(self, member_id: str, member_data: Dict[str, Any]):
        """Update member information."""
        url = f"/members/{member_id}"
        return await self._send_request("PUT", url, json=member_data)

    async def remove_member(self, member_id: str):
        """Remove a member from the workspace."""
        url = f"/members/{member_id}"
        return await self._send_request("DELETE", url)

    async def deactivate_member(self, member_id: str):
        """Deactivate a member account."""
        url = f"/members/{member_id}/deactivate"
        return await self._send_request("POST", url)

    async def reactivate_member(self, member_id: str):
        """Reactivate a deactivated member account."""
        url = f"/members/{member_id}/reactivate"
        return await self._send_request("POST", url)

    # Role Management APIs
    async def list_roles(self):
        """List all available roles in the workspace."""
        return await self._send_request("GET", "/roles")

    async def create_role(self, name: str, description: str, permissions: List[str]):
        """Create a new role with specified permissions."""
        data = {"name": name, "description": description, "permissions": permissions}
        return await self._send_request("POST", "/roles", json=data)

    async def get_role(self, role_id: str):
        """Get detailed information about a specific role."""
        url = f"/roles/{role_id}"
        return await self._send_request("GET", url)

    async def update_role(self, role_id: str, role_data: Dict[str, Any]):
        """Update role information."""
        url = f"/roles/{role_id}"
        return await self._send_request("PUT", url, json=role_data)

    async def delete_role(self, role_id: str):
        """Delete a role."""
        url = f"/roles/{role_id}"
        return await self._send_request("DELETE", url)

    # Permission Management APIs
    async def list_permissions(self):
        """List all available permissions."""
        return await self._send_request("GET", "/permissions")

    async def get_role_permissions(self, role_id: str):
        """Get permissions for a specific role."""
        url = f"/roles/{role_id}/permissions"
        return await self._send_request("GET", url)

    async def update_role_permissions(self, role_id: str, permissions: List[str]):
        """Update permissions for a role."""
        url = f"/roles/{role_id}/permissions"
        data = {"permissions": permissions}
        return await self._send_request("PUT", url, json=data)

    # Workspace Settings APIs
    async def get_workspace_settings(self):
        """Get workspace settings and configuration."""
        return await self._send_request("GET", "/workspace/settings")

    async def update_workspace_settings(self, settings_data: Dict[str, Any]):
        """Update workspace settings."""
        return await self._send_request("PUT", "/workspace/settings", json=settings_data)

    async def get_workspace_statistics(self):
        """Get workspace usage statistics."""
        return await self._send_request("GET", "/workspace/statistics")

    # Billing and Subscription APIs
    async def get_billing_info(self):
        """Get current billing information."""
        return await self._send_request("GET", "/billing")

    async def get_subscription_info(self):
        """Get current subscription information."""
        return await self._send_request("GET", "/subscription")

    async def update_subscription(self, subscription_data: Dict[str, Any]):
        """Update subscription settings."""
        return await self._send_request("PUT", "/subscription", json=subscription_data)

    async def get_billing_history(self, page: int = 1, limit: int = 20):
        """Get billing history with pagination."""
        params = {"page": page, "limit": limit}
        return await self._send_request("GET", "/billing/history", params=params)

    async def get_usage_metrics(self, start_date: str, end_date: str, metric_type: str | None = None):
        """Get usage metrics for a date range."""
        params = {"start_date": start_date, "end_date": end_date}
        if metric_type:
            params["metric_type"] = metric_type
        return await self._send_request("GET", "/usage/metrics", params=params)

    # Audit Logs APIs
    async def get_audit_logs(
        self,
        page: int = 1,
        limit: int = 20,
        action: str | None = None,
        user_id: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ):
        """Get audit logs with filtering options."""
        params = {"page": page, "limit": limit}
        if action:
            params["action"] = action
        if user_id:
            params["user_id"] = user_id
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        return await self._send_request("GET", "/audit/logs", params=params)

    async def export_audit_logs(self, format: str = "csv", filters: Dict[str, Any] | None = None):
        """Export audit logs in specified format."""
        params = {"format": format}
        if filters:
            params.update(filters)
        return await self._send_request("GET", "/audit/logs/export", params=params)


class AsyncSecurityClient(AsyncDifyClient):
    """Async Security and Access Control APIs for Dify platform security management."""

    # API Key Management APIs
    async def list_api_keys(self, page: int = 1, limit: int = 20, status: str | None = None):
        """List all API keys with pagination and filtering."""
        params = {"page": page, "limit": limit}
        if status:
            params["status"] = status
        return await self._send_request("GET", "/security/api-keys", params=params)

    async def create_api_key(
        self,
        name: str,
        permissions: List[str],
        expires_at: str | None = None,
        description: str | None = None,
    ):
        """Create a new API key with specified permissions."""
        data = {"name": name, "permissions": permissions}
        if expires_at:
            data["expires_at"] = expires_at
        if description:
            data["description"] = description
        return await self._send_request("POST", "/security/api-keys", json=data)

    async def get_api_key(self, key_id: str):
        """Get detailed information about an API key."""
        url = f"/security/api-keys/{key_id}"
        return await self._send_request("GET", url)

    async def update_api_key(self, key_id: str, key_data: Dict[str, Any]):
        """Update API key information."""
        url = f"/security/api-keys/{key_id}"
        return await self._send_request("PUT", url, json=key_data)

    async def revoke_api_key(self, key_id: str):
        """Revoke an API key."""
        url = f"/security/api-keys/{key_id}/revoke"
        return await self._send_request("POST", url)

    async def rotate_api_key(self, key_id: str):
        """Rotate an API key (generate new key)."""
        url = f"/security/api-keys/{key_id}/rotate"
        return await self._send_request("POST", url)

    # Rate Limiting APIs
    async def get_rate_limits(self):
        """Get current rate limiting configuration."""
        return await self._send_request("GET", "/security/rate-limits")

    async def update_rate_limits(self, limits_config: Dict[str, Any]):
        """Update rate limiting configuration."""
        return await self._send_request("PUT", "/security/rate-limits", json=limits_config)

    async def get_rate_limit_usage(self, timeframe: str = "1h"):
        """Get rate limit usage statistics."""
        params = {"timeframe": timeframe}
        return await self._send_request("GET", "/security/rate-limits/usage", params=params)

    # Access Control Lists APIs
    async def list_access_policies(self, page: int = 1, limit: int = 20):
        """List access control policies."""
        params = {"page": page, "limit": limit}
        return await self._send_request("GET", "/security/access-policies", params=params)

    async def create_access_policy(self, policy_data: Dict[str, Any]):
        """Create a new access control policy."""
        return await self._send_request("POST", "/security/access-policies", json=policy_data)

    async def get_access_policy(self, policy_id: str):
        """Get detailed information about an access policy."""
        url = f"/security/access-policies/{policy_id}"
        return await self._send_request("GET", url)

    async def update_access_policy(self, policy_id: str, policy_data: Dict[str, Any]):
        """Update an access control policy."""
        url = f"/security/access-policies/{policy_id}"
        return await self._send_request("PUT", url, json=policy_data)

    async def delete_access_policy(self, policy_id: str):
        """Delete an access control policy."""
        url = f"/security/access-policies/{policy_id}"
        return await self._send_request("DELETE", url)

    # Security Settings APIs
    async def get_security_settings(self):
        """Get security configuration settings."""
        return await self._send_request("GET", "/security/settings")

    async def update_security_settings(self, settings_data: Dict[str, Any]):
        """Update security configuration settings."""
        return await self._send_request("PUT", "/security/settings", json=settings_data)

    async def get_security_audit_logs(
        self,
        page: int = 1,
        limit: int = 20,
        event_type: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ):
        """Get security-specific audit logs."""
        params = {"page": page, "limit": limit}
        if event_type:
            params["event_type"] = event_type
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        return await self._send_request("GET", "/security/audit-logs", params=params)

    # IP Whitelist/Blacklist APIs
    async def get_ip_whitelist(self):
        """Get IP whitelist configuration."""
        return await self._send_request("GET", "/security/ip-whitelist")

    async def update_ip_whitelist(self, ip_list: List[str], description: str | None = None):
        """Update IP whitelist configuration."""
        data = {"ip_list": ip_list}
        if description:
            data["description"] = description
        return await self._send_request("PUT", "/security/ip-whitelist", json=data)

    async def get_ip_blacklist(self):
        """Get IP blacklist configuration."""
        return await self._send_request("GET", "/security/ip-blacklist")

    async def update_ip_blacklist(self, ip_list: List[str], description: str | None = None):
        """Update IP blacklist configuration."""
        data = {"ip_list": ip_list}
        if description:
            data["description"] = description
        return await self._send_request("PUT", "/security/ip-blacklist", json=data)

    # Authentication Settings APIs
    async def get_auth_settings(self):
        """Get authentication configuration settings."""
        return await self._send_request("GET", "/security/auth-settings")

    async def update_auth_settings(self, auth_data: Dict[str, Any]):
        """Update authentication configuration settings."""
        return await self._send_request("PUT", "/security/auth-settings", json=auth_data)

    async def test_auth_configuration(self, auth_config: Dict[str, Any]):
        """Test authentication configuration."""
        return await self._send_request("POST", "/security/auth-settings/test", json=auth_config)


class AsyncAnalyticsClient(AsyncDifyClient):
    """Async Analytics and Monitoring APIs for Dify platform insights and metrics."""

    # Usage Analytics APIs
    async def get_usage_analytics(
        self,
        start_date: str,
        end_date: str,
        granularity: str = "day",
        metrics: List[str] | None = None,
    ):
        """Get usage analytics for specified date range."""
        params = {
            "start_date": start_date,
            "end_date": end_date,
            "granularity": granularity,
        }
        if metrics:
            params["metrics"] = ",".join(metrics)
        return await self._send_request("GET", "/analytics/usage", params=params)

    async def get_app_usage_analytics(self, app_id: str, start_date: str, end_date: str, granularity: str = "day"):
        """Get usage analytics for a specific app."""
        params = {
            "start_date": start_date,
            "end_date": end_date,
            "granularity": granularity,
        }
        url = f"/analytics/apps/{app_id}/usage"
        return await self._send_request("GET", url, params=params)

    async def get_user_analytics(self, start_date: str, end_date: str, user_segment: str | None = None):
        """Get user analytics and behavior insights."""
        params = {"start_date": start_date, "end_date": end_date}
        if user_segment:
            params["user_segment"] = user_segment
        return await self._send_request("GET", "/analytics/users", params=params)

    # Performance Metrics APIs
    async def get_performance_metrics(self, start_date: str, end_date: str, metric_type: str | None = None):
        """Get performance metrics for the platform."""
        params = {"start_date": start_date, "end_date": end_date}
        if metric_type:
            params["metric_type"] = metric_type
        return await self._send_request("GET", "/analytics/performance", params=params)

    async def get_app_performance_metrics(self, app_id: str, start_date: str, end_date: str):
        """Get performance metrics for a specific app."""
        params = {"start_date": start_date, "end_date": end_date}
        url = f"/analytics/apps/{app_id}/performance"
        return await self._send_request("GET", url, params=params)

    async def get_model_performance_metrics(self, model_provider: str, model_name: str, start_date: str, end_date: str):
        """Get performance metrics for a specific model."""
        params = {"start_date": start_date, "end_date": end_date}
        url = f"/analytics/models/{model_provider}/{model_name}/performance"
        return await self._send_request("GET", url, params=params)

    # Cost Tracking APIs
    async def get_cost_analytics(self, start_date: str, end_date: str, cost_type: str | None = None):
        """Get cost analytics and breakdown."""
        params = {"start_date": start_date, "end_date": end_date}
        if cost_type:
            params["cost_type"] = cost_type
        return await self._send_request("GET", "/analytics/costs", params=params)

    async def get_app_cost_analytics(self, app_id: str, start_date: str, end_date: str):
        """Get cost analytics for a specific app."""
        params = {"start_date": start_date, "end_date": end_date}
        url = f"/analytics/apps/{app_id}/costs"
        return await self._send_request("GET", url, params=params)

    async def get_cost_forecast(self, forecast_period: str = "30d"):
        """Get cost forecast for specified period."""
        params = {"forecast_period": forecast_period}
        return await self._send_request("GET", "/analytics/costs/forecast", params=params)

    # Real-time Monitoring APIs
    async def get_real_time_metrics(self):
        """Get real-time platform metrics."""
        return await self._send_request("GET", "/analytics/realtime")

    async def get_app_real_time_metrics(self, app_id: str):
        """Get real-time metrics for a specific app."""
        url = f"/analytics/apps/{app_id}/realtime"
        return await self._send_request("GET", url)

    async def get_system_health(self):
        """Get overall system health status."""
        return await self._send_request("GET", "/analytics/health")

    # Custom Reports APIs
    async def create_custom_report(self, report_config: Dict[str, Any]):
        """Create a custom analytics report."""
        return await self._send_request("POST", "/analytics/reports", json=report_config)

    async def list_custom_reports(self, page: int = 1, limit: int = 20):
        """List custom analytics reports."""
        params = {"page": page, "limit": limit}
        return await self._send_request("GET", "/analytics/reports", params=params)

    async def get_custom_report(self, report_id: str):
        """Get a specific custom report."""
        url = f"/analytics/reports/{report_id}"
        return await self._send_request("GET", url)

    async def update_custom_report(self, report_id: str, report_config: Dict[str, Any]):
        """Update a custom analytics report."""
        url = f"/analytics/reports/{report_id}"
        return await self._send_request("PUT", url, json=report_config)

    async def delete_custom_report(self, report_id: str):
        """Delete a custom analytics report."""
        url = f"/analytics/reports/{report_id}"
        return await self._send_request("DELETE", url)

    async def generate_report(self, report_id: str, format: str = "pdf"):
        """Generate and download a custom report."""
        params = {"format": format}
        url = f"/analytics/reports/{report_id}/generate"
        return await self._send_request("GET", url, params=params)

    # Export APIs
    async def export_analytics_data(self, data_type: str, start_date: str, end_date: str, format: str = "csv"):
        """Export analytics data in specified format."""
        params = {
            "data_type": data_type,
            "start_date": start_date,
            "end_date": end_date,
            "format": format,
        }
        return await self._send_request("GET", "/analytics/export", params=params)


class AsyncIntegrationClient(AsyncDifyClient):
    """Async Integration and Plugin APIs for Dify platform extensibility."""

    # Webhook Management APIs
    async def list_webhooks(self, page: int = 1, limit: int = 20, status: str | None = None):
        """List webhooks with pagination and filtering."""
        params = {"page": page, "limit": limit}
        if status:
            params["status"] = status
        return await self._send_request("GET", "/integrations/webhooks", params=params)

    async def create_webhook(self, webhook_data: Dict[str, Any]):
        """Create a new webhook."""
        return await self._send_request("POST", "/integrations/webhooks", json=webhook_data)

    async def get_webhook(self, webhook_id: str):
        """Get detailed information about a webhook."""
        url = f"/integrations/webhooks/{webhook_id}"
        return await self._send_request("GET", url)

    async def update_webhook(self, webhook_id: str, webhook_data: Dict[str, Any]):
        """Update webhook configuration."""
        url = f"/integrations/webhooks/{webhook_id}"
        return await self._send_request("PUT", url, json=webhook_data)

    async def delete_webhook(self, webhook_id: str):
        """Delete a webhook."""
        url = f"/integrations/webhooks/{webhook_id}"
        return await self._send_request("DELETE", url)

    async def test_webhook(self, webhook_id: str):
        """Test webhook delivery."""
        url = f"/integrations/webhooks/{webhook_id}/test"
        return await self._send_request("POST", url)

    async def get_webhook_logs(self, webhook_id: str, page: int = 1, limit: int = 20):
        """Get webhook delivery logs."""
        params = {"page": page, "limit": limit}
        url = f"/integrations/webhooks/{webhook_id}/logs"
        return await self._send_request("GET", url, params=params)

    # Plugin Management APIs
    async def list_plugins(self, page: int = 1, limit: int = 20, category: str | None = None):
        """List available plugins."""
        params = {"page": page, "limit": limit}
        if category:
            params["category"] = category
        return await self._send_request("GET", "/integrations/plugins", params=params)

    async def install_plugin(self, plugin_id: str, config: Dict[str, Any] | None = None):
        """Install a plugin."""
        data = {"plugin_id": plugin_id}
        if config:
            data["config"] = config
        return await self._send_request("POST", "/integrations/plugins/install", json=data)

    async def get_installed_plugin(self, installation_id: str):
        """Get information about an installed plugin."""
        url = f"/integrations/plugins/{installation_id}"
        return await self._send_request("GET", url)

    async def update_plugin_config(self, installation_id: str, config: Dict[str, Any]):
        """Update plugin configuration."""
        url = f"/integrations/plugins/{installation_id}/config"
        return await self._send_request("PUT", url, json=config)

    async def uninstall_plugin(self, installation_id: str):
        """Uninstall a plugin."""
        url = f"/integrations/plugins/{installation_id}"
        return await self._send_request("DELETE", url)

    async def enable_plugin(self, installation_id: str):
        """Enable a plugin."""
        url = f"/integrations/plugins/{installation_id}/enable"
        return await self._send_request("POST", url)

    async def disable_plugin(self, installation_id: str):
        """Disable a plugin."""
        url = f"/integrations/plugins/{installation_id}/disable"
        return await self._send_request("POST", url)

    # Import/Export APIs
    async def export_app_data(self, app_id: str, format: str = "json", include_data: bool = True):
        """Export application data."""
        params = {"format": format, "include_data": include_data}
        url = f"/integrations/export/apps/{app_id}"
        return await self._send_request("GET", url, params=params)

    async def import_app_data(self, import_data: Dict[str, Any]):
        """Import application data."""
        return await self._send_request("POST", "/integrations/import/apps", json=import_data)

    async def get_import_status(self, import_id: str):
        """Get import operation status."""
        url = f"/integrations/import/{import_id}/status"
        return await self._send_request("GET", url)

    async def export_workspace_data(self, format: str = "json", include_data: bool = True):
        """Export workspace data."""
        params = {"format": format, "include_data": include_data}
        return await self._send_request("GET", "/integrations/export/workspace", params=params)

    async def import_workspace_data(self, import_data: Dict[str, Any]):
        """Import workspace data."""
        return await self._send_request("POST", "/integrations/import/workspace", json=import_data)

    # Backup and Restore APIs
    async def create_backup(self, backup_config: Dict[str, Any] | None = None):
        """Create a system backup."""
        data = backup_config or {}
        return await self._send_request("POST", "/integrations/backup/create", json=data)

    async def list_backups(self, page: int = 1, limit: int = 20):
        """List available backups."""
        params = {"page": page, "limit": limit}
        return await self._send_request("GET", "/integrations/backup", params=params)

    async def get_backup(self, backup_id: str):
        """Get backup information."""
        url = f"/integrations/backup/{backup_id}"
        return await self._send_request("GET", url)

    async def restore_backup(self, backup_id: str, restore_config: Dict[str, Any] | None = None):
        """Restore from backup."""
        data = restore_config or {}
        url = f"/integrations/backup/{backup_id}/restore"
        return await self._send_request("POST", url, json=data)

    async def delete_backup(self, backup_id: str):
        """Delete a backup."""
        url = f"/integrations/backup/{backup_id}"
        return await self._send_request("DELETE", url)


class AsyncAdvancedModelClient(AsyncDifyClient):
    """Async Advanced Model Management APIs for fine-tuning and custom deployments."""

    # Fine-tuning Job Management APIs
    async def list_fine_tuning_jobs(
        self,
        page: int = 1,
        limit: int = 20,
        status: str | None = None,
        model_provider: str | None = None,
    ):
        """List fine-tuning jobs with filtering."""
        params = {"page": page, "limit": limit}
        if status:
            params["status"] = status
        if model_provider:
            params["model_provider"] = model_provider
        return await self._send_request("GET", "/models/fine-tuning/jobs", params=params)

    async def create_fine_tuning_job(self, job_config: Dict[str, Any]):
        """Create a new fine-tuning job."""
        return await self._send_request("POST", "/models/fine-tuning/jobs", json=job_config)

    async def get_fine_tuning_job(self, job_id: str):
        """Get fine-tuning job details."""
        url = f"/models/fine-tuning/jobs/{job_id}"
        return await self._send_request("GET", url)

    async def update_fine_tuning_job(self, job_id: str, job_config: Dict[str, Any]):
        """Update fine-tuning job configuration."""
        url = f"/models/fine-tuning/jobs/{job_id}"
        return await self._send_request("PUT", url, json=job_config)

    async def cancel_fine_tuning_job(self, job_id: str):
        """Cancel a fine-tuning job."""
        url = f"/models/fine-tuning/jobs/{job_id}/cancel"
        return await self._send_request("POST", url)

    async def resume_fine_tuning_job(self, job_id: str):
        """Resume a paused fine-tuning job."""
        url = f"/models/fine-tuning/jobs/{job_id}/resume"
        return await self._send_request("POST", url)

    async def get_fine_tuning_job_metrics(self, job_id: str):
        """Get fine-tuning job training metrics."""
        url = f"/models/fine-tuning/jobs/{job_id}/metrics"
        return await self._send_request("GET", url)

    async def get_fine_tuning_job_logs(self, job_id: str, page: int = 1, limit: int = 50):
        """Get fine-tuning job logs."""
        params = {"page": page, "limit": limit}
        url = f"/models/fine-tuning/jobs/{job_id}/logs"
        return await self._send_request("GET", url, params=params)

    # Custom Model Deployment APIs
    async def list_custom_deployments(self, page: int = 1, limit: int = 20, status: str | None = None):
        """List custom model deployments."""
        params = {"page": page, "limit": limit}
        if status:
            params["status"] = status
        return await self._send_request("GET", "/models/custom/deployments", params=params)

    async def create_custom_deployment(self, deployment_config: Dict[str, Any]):
        """Create a custom model deployment."""
        return await self._send_request("POST", "/models/custom/deployments", json=deployment_config)

    async def get_custom_deployment(self, deployment_id: str):
        """Get custom deployment details."""
        url = f"/models/custom/deployments/{deployment_id}"
        return await self._send_request("GET", url)

    async def update_custom_deployment(self, deployment_id: str, deployment_config: Dict[str, Any]):
        """Update custom deployment configuration."""
        url = f"/models/custom/deployments/{deployment_id}"
        return await self._send_request("PUT", url, json=deployment_config)

    async def delete_custom_deployment(self, deployment_id: str):
        """Delete a custom deployment."""
        url = f"/models/custom/deployments/{deployment_id}"
        return await self._send_request("DELETE", url)

    async def scale_custom_deployment(self, deployment_id: str, scale_config: Dict[str, Any]):
        """Scale custom deployment resources."""
        url = f"/models/custom/deployments/{deployment_id}/scale"
        return await self._send_request("POST", url, json=scale_config)

    async def restart_custom_deployment(self, deployment_id: str):
        """Restart a custom deployment."""
        url = f"/models/custom/deployments/{deployment_id}/restart"
        return await self._send_request("POST", url)

    # Model Performance Monitoring APIs
    async def get_model_performance_history(
        self,
        model_provider: str,
        model_name: str,
        start_date: str,
        end_date: str,
        metrics: List[str] | None = None,
    ):
        """Get model performance history."""
        params = {"start_date": start_date, "end_date": end_date}
        if metrics:
            params["metrics"] = ",".join(metrics)
        url = f"/models/{model_provider}/{model_name}/performance/history"
        return await self._send_request("GET", url, params=params)

    async def get_model_health_metrics(self, model_provider: str, model_name: str):
        """Get real-time model health metrics."""
        url = f"/models/{model_provider}/{model_name}/health"
        return await self._send_request("GET", url)

    async def get_model_usage_stats(
        self,
        model_provider: str,
        model_name: str,
        start_date: str,
        end_date: str,
        granularity: str = "day",
    ):
        """Get model usage statistics."""
        params = {
            "start_date": start_date,
            "end_date": end_date,
            "granularity": granularity,
        }
        url = f"/models/{model_provider}/{model_name}/usage"
        return await self._send_request("GET", url, params=params)

    async def get_model_cost_analysis(self, model_provider: str, model_name: str, start_date: str, end_date: str):
        """Get model cost analysis."""
        params = {"start_date": start_date, "end_date": end_date}
        url = f"/models/{model_provider}/{model_name}/costs"
        return await self._send_request("GET", url, params=params)

    # Model Versioning APIs
    async def list_model_versions(self, model_provider: str, model_name: str, page: int = 1, limit: int = 20):
        """List model versions."""
        params = {"page": page, "limit": limit}
        url = f"/models/{model_provider}/{model_name}/versions"
        return await self._send_request("GET", url, params=params)

    async def create_model_version(self, model_provider: str, model_name: str, version_config: Dict[str, Any]):
        """Create a new model version."""
        url = f"/models/{model_provider}/{model_name}/versions"
        return await self._send_request("POST", url, json=version_config)

    async def get_model_version(self, model_provider: str, model_name: str, version_id: str):
        """Get model version details."""
        url = f"/models/{model_provider}/{model_name}/versions/{version_id}"
        return await self._send_request("GET", url)

    async def promote_model_version(self, model_provider: str, model_name: str, version_id: str):
        """Promote model version to production."""
        url = f"/models/{model_provider}/{model_name}/versions/{version_id}/promote"
        return await self._send_request("POST", url)

    async def rollback_model_version(self, model_provider: str, model_name: str, version_id: str):
        """Rollback to a specific model version."""
        url = f"/models/{model_provider}/{model_name}/versions/{version_id}/rollback"
        return await self._send_request("POST", url)

    # Model Registry APIs
    async def list_registry_models(self, page: int = 1, limit: int = 20, filter: str | None = None):
        """List models in registry."""
        params = {"page": page, "limit": limit}
        if filter:
            params["filter"] = filter
        return await self._send_request("GET", "/models/registry", params=params)

    async def register_model(self, model_config: Dict[str, Any]):
        """Register a new model in the registry."""
        return await self._send_request("POST", "/models/registry", json=model_config)

    async def get_registry_model(self, model_id: str):
        """Get registered model details."""
        url = f"/models/registry/{model_id}"
        return await self._send_request("GET", url)

    async def update_registry_model(self, model_id: str, model_config: Dict[str, Any]):
        """Update registered model information."""
        url = f"/models/registry/{model_id}"
        return await self._send_request("PUT", url, json=model_config)

    async def unregister_model(self, model_id: str):
        """Unregister a model from the registry."""
        url = f"/models/registry/{model_id}"
        return await self._send_request("DELETE", url)


class AsyncAdvancedAppClient(AsyncDifyClient):
    """Async Advanced App Configuration APIs for comprehensive app management."""

    # App Creation and Management APIs
    async def create_app(self, app_config: Dict[str, Any]):
        """Create a new application."""
        return await self._send_request("POST", "/apps", json=app_config)

    async def list_apps(
        self,
        page: int = 1,
        limit: int = 20,
        app_type: str | None = None,
        status: str | None = None,
    ):
        """List applications with filtering."""
        params = {"page": page, "limit": limit}
        if app_type:
            params["app_type"] = app_type
        if status:
            params["status"] = status
        return await self._send_request("GET", "/apps", params=params)

    async def get_app(self, app_id: str):
        """Get detailed application information."""
        url = f"/apps/{app_id}"
        return await self._send_request("GET", url)

    async def update_app(self, app_id: str, app_config: Dict[str, Any]):
        """Update application configuration."""
        url = f"/apps/{app_id}"
        return await self._send_request("PUT", url, json=app_config)

    async def delete_app(self, app_id: str):
        """Delete an application."""
        url = f"/apps/{app_id}"
        return await self._send_request("DELETE", url)

    async def duplicate_app(self, app_id: str, duplicate_config: Dict[str, Any]):
        """Duplicate an application."""
        url = f"/apps/{app_id}/duplicate"
        return await self._send_request("POST", url, json=duplicate_config)

    async def archive_app(self, app_id: str):
        """Archive an application."""
        url = f"/apps/{app_id}/archive"
        return await self._send_request("POST", url)

    async def restore_app(self, app_id: str):
        """Restore an archived application."""
        url = f"/apps/{app_id}/restore"
        return await self._send_request("POST", url)

    # App Publishing and Versioning APIs
    async def publish_app(self, app_id: str, publish_config: Dict[str, Any] | None = None):
        """Publish an application."""
        data = publish_config or {}
        url = f"/apps/{app_id}/publish"
        return await self._send_request("POST", url, json=data)

    async def unpublish_app(self, app_id: str):
        """Unpublish an application."""
        url = f"/apps/{app_id}/unpublish"
        return await self._send_request("POST", url)

    async def list_app_versions(self, app_id: str, page: int = 1, limit: int = 20):
        """List application versions."""
        params = {"page": page, "limit": limit}
        url = f"/apps/{app_id}/versions"
        return await self._send_request("GET", url, params=params)

    async def create_app_version(self, app_id: str, version_config: Dict[str, Any]):
        """Create a new application version."""
        url = f"/apps/{app_id}/versions"
        return await self._send_request("POST", url, json=version_config)

    async def get_app_version(self, app_id: str, version_id: str):
        """Get application version details."""
        url = f"/apps/{app_id}/versions/{version_id}"
        return await self._send_request("GET", url)

    async def rollback_app_version(self, app_id: str, version_id: str):
        """Rollback application to a specific version."""
        url = f"/apps/{app_id}/versions/{version_id}/rollback"
        return await self._send_request("POST", url)

    # App Template APIs
    async def list_app_templates(self, page: int = 1, limit: int = 20, category: str | None = None):
        """List available app templates."""
        params = {"page": page, "limit": limit}
        if category:
            params["category"] = category
        return await self._send_request("GET", "/apps/templates", params=params)

    async def get_app_template(self, template_id: str):
        """Get app template details."""
        url = f"/apps/templates/{template_id}"
        return await self._send_request("GET", url)

    async def create_app_from_template(self, template_id: str, app_config: Dict[str, Any]):
        """Create an app from a template."""
        url = f"/apps/templates/{template_id}/create"
        return await self._send_request("POST", url, json=app_config)

    async def create_custom_template(self, app_id: str, template_config: Dict[str, Any]):
        """Create a custom template from an existing app."""
        url = f"/apps/{app_id}/create-template"
        return await self._send_request("POST", url, json=template_config)

    # App Analytics and Metrics APIs
    async def get_app_analytics(
        self,
        app_id: str,
        start_date: str,
        end_date: str,
        metrics: List[str] | None = None,
    ):
        """Get application analytics."""
        params = {"start_date": start_date, "end_date": end_date}
        if metrics:
            params["metrics"] = ",".join(metrics)
        url = f"/apps/{app_id}/analytics"
        return await self._send_request("GET", url, params=params)

    async def get_app_user_feedback(self, app_id: str, page: int = 1, limit: int = 20, rating: int | None = None):
        """Get user feedback for an application."""
        params = {"page": page, "limit": limit}
        if rating:
            params["rating"] = rating
        url = f"/apps/{app_id}/feedback"
        return await self._send_request("GET", url, params=params)

    async def get_app_error_logs(
        self,
        app_id: str,
        start_date: str,
        end_date: str,
        error_type: str | None = None,
        page: int = 1,
        limit: int = 20,
    ):
        """Get application error logs."""
        params = {
            "start_date": start_date,
            "end_date": end_date,
            "page": page,
            "limit": limit,
        }
        if error_type:
            params["error_type"] = error_type
        url = f"/apps/{app_id}/errors"
        return await self._send_request("GET", url, params=params)

    # Advanced Configuration APIs
    async def get_app_advanced_config(self, app_id: str):
        """Get advanced application configuration."""
        url = f"/apps/{app_id}/advanced-config"
        return await self._send_request("GET", url)

    async def update_app_advanced_config(self, app_id: str, config: Dict[str, Any]):
        """Update advanced application configuration."""
        url = f"/apps/{app_id}/advanced-config"
        return await self._send_request("PUT", url, json=config)

    async def get_app_environment_variables(self, app_id: str):
        """Get application environment variables."""
        url = f"/apps/{app_id}/environment"
        return await self._send_request("GET", url)

    async def update_app_environment_variables(self, app_id: str, variables: Dict[str, str]):
        """Update application environment variables."""
        url = f"/apps/{app_id}/environment"
        return await self._send_request("PUT", url, json=variables)

    async def get_app_resource_limits(self, app_id: str):
        """Get application resource limits."""
        url = f"/apps/{app_id}/resource-limits"
        return await self._send_request("GET", url)

    async def update_app_resource_limits(self, app_id: str, limits: Dict[str, Any]):
        """Update application resource limits."""
        url = f"/apps/{app_id}/resource-limits"
        return await self._send_request("PUT", url, json=limits)

    # App Integration APIs
    async def get_app_integrations(self, app_id: str):
        """Get application integrations."""
        url = f"/apps/{app_id}/integrations"
        return await self._send_request("GET", url)

    async def add_app_integration(self, app_id: str, integration_config: Dict[str, Any]):
        """Add integration to application."""
        url = f"/apps/{app_id}/integrations"
        return await self._send_request("POST", url, json=integration_config)

    async def update_app_integration(self, app_id: str, integration_id: str, config: Dict[str, Any]):
        """Update application integration."""
        url = f"/apps/{app_id}/integrations/{integration_id}"
        return await self._send_request("PUT", url, json=config)

    async def remove_app_integration(self, app_id: str, integration_id: str):
        """Remove integration from application."""
        url = f"/apps/{app_id}/integrations/{integration_id}"
        return await self._send_request("DELETE", url)

    async def test_app_integration(self, app_id: str, integration_id: str):
        """Test application integration."""
        url = f"/apps/{app_id}/integrations/{integration_id}/test"
        return await self._send_request("POST", url)
