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
from typing import Literal, Dict, List, Any, IO

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
        json: dict | None = None,
        params: dict | None = None,
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


class AsyncCompletionClient(AsyncDifyClient):
    """Async client for Completion API operations."""

    async def create_completion_message(
        self,
        inputs: dict,
        response_mode: Literal["blocking", "streaming"],
        user: str,
        files: dict | None = None,
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
        files: dict | None = None,
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

    async def audio_to_text(self, audio_file: IO[bytes] | tuple, user: str):
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


class AsyncWorkspaceClient(AsyncDifyClient):
    """Async client for workspace-related operations."""

    async def get_available_models(self, model_type: str):
        """Get available models by model type."""
        url = f"/workspaces/current/models/model-types/{model_type}"
        return await self._send_request("GET", url)


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

    async def create_document_by_text(self, name: str, text: str, extra_params: dict | None = None, **kwargs):
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
        extra_params: dict | None = None,
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
        extra_params: dict | None = None,
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

    async def update_document_by_file(self, document_id: str, file_path: str, extra_params: dict | None = None):
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
