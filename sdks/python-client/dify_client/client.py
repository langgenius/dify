import json
from typing import Literal, Union, Dict, List, Any, Optional, IO

import requests


class DifyClient:
    def __init__(self, api_key, base_url: str = "https://api.dify.ai/v1"):
        self.api_key = api_key
        self.base_url = base_url

    def _send_request(
        self, method: str, endpoint: str, json: dict | None = None, params: dict | None = None, stream: bool = False
    ):
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        url = f"{self.base_url}{endpoint}"
        response = requests.request(method, url, json=json, params=params, headers=headers, stream=stream)

        return response

    def _send_request_with_files(self, method, endpoint, data, files):
        headers = {"Authorization": f"Bearer {self.api_key}"}

        url = f"{self.base_url}{endpoint}"
        response = requests.request(method, url, data=data, headers=headers, files=files)

        return response

    def message_feedback(self, message_id: str, rating: Literal["like", "dislike"], user: str):
        data = {"rating": rating, "user": user}
        return self._send_request("POST", f"/messages/{message_id}/feedbacks", data)

    def get_application_parameters(self, user: str):
        params = {"user": user}
        return self._send_request("GET", "/parameters", params=params)

    def file_upload(self, user: str, files: dict):
        data = {"user": user}
        return self._send_request_with_files("POST", "/files/upload", data=data, files=files)

    def text_to_audio(self, text: str, user: str, streaming: bool = False):
        data = {"text": text, "user": user, "streaming": streaming}
        return self._send_request("POST", "/text-to-audio", json=data)

    def get_meta(self, user: str):
        params = {"user": user}
        return self._send_request("GET", "/meta", params=params)

    def get_app_info(self):
        """Get basic application information including name, description, tags, and mode."""
        return self._send_request("GET", "/info")

    def get_app_site_info(self):
        """Get application site information."""
        return self._send_request("GET", "/site")

    def get_file_preview(self, file_id: str):
        """Get file preview by file ID."""
        return self._send_request("GET", f"/files/{file_id}/preview")


class CompletionClient(DifyClient):
    def create_completion_message(
        self, inputs: dict, response_mode: Literal["blocking", "streaming"], user: str, files: dict | None = None
    ):
        data = {
            "inputs": inputs,
            "response_mode": response_mode,
            "user": user,
            "files": files,
        }
        return self._send_request(
            "POST",
            "/completion-messages",
            data,
            stream=True if response_mode == "streaming" else False,
        )


class ChatClient(DifyClient):
    def create_chat_message(
        self,
        inputs: dict,
        query: str,
        user: str,
        response_mode: Literal["blocking", "streaming"] = "blocking",
        conversation_id: str | None = None,
        files: dict | None = None,
    ):
        data = {
            "inputs": inputs,
            "query": query,
            "user": user,
            "response_mode": response_mode,
            "files": files,
        }
        if conversation_id:
            data["conversation_id"] = conversation_id

        return self._send_request(
            "POST",
            "/chat-messages",
            data,
            stream=True if response_mode == "streaming" else False,
        )

    def get_suggested(self, message_id: str, user: str):
        params = {"user": user}
        return self._send_request("GET", f"/messages/{message_id}/suggested", params=params)

    def stop_message(self, task_id: str, user: str):
        data = {"user": user}
        return self._send_request("POST", f"/chat-messages/{task_id}/stop", data)

    def get_conversations(
        self,
        user: str,
        last_id: str | None = None,
        limit: int | None = None,
        pinned: bool | None = None,
    ):
        params = {"user": user, "last_id": last_id, "limit": limit, "pinned": pinned}
        return self._send_request("GET", "/conversations", params=params)

    def get_conversation_messages(
        self,
        user: str,
        conversation_id: str | None = None,
        first_id: str | None = None,
        limit: int | None = None,
    ):
        params = {"user": user}

        if conversation_id:
            params["conversation_id"] = conversation_id
        if first_id:
            params["first_id"] = first_id
        if limit:
            params["limit"] = limit

        return self._send_request("GET", "/messages", params=params)

    def rename_conversation(self, conversation_id: str, name: str, auto_generate: bool, user: str):
        data = {"name": name, "auto_generate": auto_generate, "user": user}
        return self._send_request("POST", f"/conversations/{conversation_id}/name", data)

    def delete_conversation(self, conversation_id: str, user: str):
        data = {"user": user}
        return self._send_request("DELETE", f"/conversations/{conversation_id}", data)

    def audio_to_text(self, audio_file: IO[bytes] | tuple, user: str):
        data = {"user": user}
        files = {"file": audio_file}
        return self._send_request_with_files("POST", "/audio-to-text", data, files)

    # Annotation APIs
    def annotation_reply_action(
        self,
        action: Literal["enable", "disable"],
        score_threshold: float,
        embedding_provider_name: str,
        embedding_model_name: str,
    ):
        """Enable or disable annotation reply feature."""
        # Backend API requires these fields to be non-None values
        if score_threshold is None or embedding_provider_name is None or embedding_model_name is None:
            raise ValueError("score_threshold, embedding_provider_name, and embedding_model_name cannot be None")

        data = {
            "score_threshold": score_threshold,
            "embedding_provider_name": embedding_provider_name,
            "embedding_model_name": embedding_model_name,
        }
        return self._send_request("POST", f"/apps/annotation-reply/{action}", json=data)

    def get_annotation_reply_status(self, action: Literal["enable", "disable"], job_id: str):
        """Get the status of an annotation reply action job."""
        return self._send_request("GET", f"/apps/annotation-reply/{action}/status/{job_id}")

    def list_annotations(self, page: int = 1, limit: int = 20, keyword: str = ""):
        """List annotations for the application."""
        params = {"page": page, "limit": limit}
        if keyword:
            params["keyword"] = keyword
        return self._send_request("GET", "/apps/annotations", params=params)

    def create_annotation(self, question: str, answer: str):
        """Create a new annotation."""
        data = {"question": question, "answer": answer}
        return self._send_request("POST", "/apps/annotations", json=data)

    def update_annotation(self, annotation_id: str, question: str, answer: str):
        """Update an existing annotation."""
        data = {"question": question, "answer": answer}
        return self._send_request("PUT", f"/apps/annotations/{annotation_id}", json=data)

    def delete_annotation(self, annotation_id: str):
        """Delete an annotation."""
        return self._send_request("DELETE", f"/apps/annotations/{annotation_id}")


class WorkflowClient(DifyClient):
    def run(self, inputs: dict, response_mode: Literal["blocking", "streaming"] = "streaming", user: str = "abc-123"):
        data = {"inputs": inputs, "response_mode": response_mode, "user": user}
        return self._send_request("POST", "/workflows/run", data)

    def stop(self, task_id, user):
        data = {"user": user}
        return self._send_request("POST", f"/workflows/tasks/{task_id}/stop", data)

    def get_result(self, workflow_run_id):
        return self._send_request("GET", f"/workflows/run/{workflow_run_id}")

    def get_workflow_logs(
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
        params = {"page": page, "limit": limit}
        if keyword:
            params["keyword"] = keyword
        if status:
            params["status"] = status
        if created_at__before:
            params["created_at__before"] = created_at__before
        if created_at__after:
            params["created_at__after"] = created_at__after
        if created_by_end_user_session_id:
            params["created_by_end_user_session_id"] = created_by_end_user_session_id
        if created_by_account:
            params["created_by_account"] = created_by_account
        return self._send_request("GET", "/workflows/logs", params=params)

    def run_specific_workflow(
        self,
        workflow_id: str,
        inputs: dict,
        response_mode: Literal["blocking", "streaming"] = "streaming",
        user: str = "abc-123",
    ):
        """Run a specific workflow by workflow ID."""
        data = {"inputs": inputs, "response_mode": response_mode, "user": user}
        return self._send_request(
            "POST", f"/workflows/{workflow_id}/run", data, stream=True if response_mode == "streaming" else False
        )


class WorkspaceClient(DifyClient):
    """Client for workspace-related operations."""

    def get_available_models(self, model_type: str):
        """Get available models by model type."""
        url = f"/workspaces/current/models/model-types/{model_type}"
        return self._send_request("GET", url)


class KnowledgeBaseClient(DifyClient):
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.dify.ai/v1",
        dataset_id: str | None = None,
    ):
        """
        Construct a KnowledgeBaseClient object.

        Args:
            api_key (str): API key of Dify.
            base_url (str, optional): Base URL of Dify API. Defaults to 'https://api.dify.ai/v1'.
            dataset_id (str, optional): ID of the dataset. Defaults to None. You don't need this if you just want to
                create a new dataset. or list datasets. otherwise you need to set this.
        """
        super().__init__(api_key=api_key, base_url=base_url)
        self.dataset_id = dataset_id

    def _get_dataset_id(self):
        if self.dataset_id is None:
            raise ValueError("dataset_id is not set")
        return self.dataset_id

    def create_dataset(self, name: str, **kwargs):
        return self._send_request("POST", "/datasets", {"name": name}, **kwargs)

    def list_datasets(self, page: int = 1, page_size: int = 20, **kwargs):
        return self._send_request("GET", f"/datasets?page={page}&limit={page_size}", **kwargs)

    def create_document_by_text(self, name, text, extra_params: dict | None = None, **kwargs):
        """
        Create a document by text.

        :param name: Name of the document
        :param text: Text content of the document
        :param extra_params: extra parameters pass to the API, such as indexing_technique, process_rule. (optional)
            e.g.
            {
            'indexing_technique': 'high_quality',
            'process_rule': {
                'rules': {
                    'pre_processing_rules': [
                        {'id': 'remove_extra_spaces', 'enabled': True},
                        {'id': 'remove_urls_emails', 'enabled': True}
                    ],
                    'segmentation': {
                        'separator': '\n',
                        'max_tokens': 500
                    }
                },
                'mode': 'custom'
            }
        }
        :return: Response from the API
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
        return self._send_request("POST", url, json=data, **kwargs)

    def update_document_by_text(
        self, document_id: str, name: str, text: str, extra_params: dict | None = None, **kwargs
    ):
        """
        Update a document by text.

        :param document_id: ID of the document
        :param name: Name of the document
        :param text: Text content of the document
        :param extra_params: extra parameters pass to the API, such as indexing_technique, process_rule. (optional)
            e.g.
            {
            'indexing_technique': 'high_quality',
            'process_rule': {
                'rules': {
                    'pre_processing_rules': [
                        {'id': 'remove_extra_spaces', 'enabled': True},
                        {'id': 'remove_urls_emails', 'enabled': True}
                    ],
                    'segmentation': {
                        'separator': '\n',
                        'max_tokens': 500
                    }
                },
                'mode': 'custom'
            }
        }
        :return: Response from the API
        """
        data = {"name": name, "text": text}
        if extra_params is not None and isinstance(extra_params, dict):
            data.update(extra_params)
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/update_by_text"
        return self._send_request("POST", url, json=data, **kwargs)

    def create_document_by_file(
        self, file_path: str, original_document_id: str | None = None, extra_params: dict | None = None
    ):
        """
        Create a document by file.

        :param file_path: Path to the file
        :param original_document_id: pass this ID if you want to replace the original document (optional)
        :param extra_params: extra parameters pass to the API, such as indexing_technique, process_rule. (optional)
            e.g.
            {
            'indexing_technique': 'high_quality',
            'process_rule': {
                'rules': {
                    'pre_processing_rules': [
                        {'id': 'remove_extra_spaces', 'enabled': True},
                        {'id': 'remove_urls_emails', 'enabled': True}
                    ],
                    'segmentation': {
                        'separator': '\n',
                        'max_tokens': 500
                    }
                },
                'mode': 'custom'
            }
        }
        :return: Response from the API
        """
        files = {"file": open(file_path, "rb")}
        data = {
            "process_rule": {"mode": "automatic"},
            "indexing_technique": "high_quality",
        }
        if extra_params is not None and isinstance(extra_params, dict):
            data.update(extra_params)
        if original_document_id is not None:
            data["original_document_id"] = original_document_id
        url = f"/datasets/{self._get_dataset_id()}/document/create_by_file"
        return self._send_request_with_files("POST", url, {"data": json.dumps(data)}, files)

    def update_document_by_file(self, document_id: str, file_path: str, extra_params: dict | None = None):
        """
        Update a document by file.

        :param document_id: ID of the document
        :param file_path: Path to the file
        :param extra_params: extra parameters pass to the API, such as indexing_technique, process_rule. (optional)
            e.g.
            {
            'indexing_technique': 'high_quality',
            'process_rule': {
                'rules': {
                    'pre_processing_rules': [
                        {'id': 'remove_extra_spaces', 'enabled': True},
                        {'id': 'remove_urls_emails', 'enabled': True}
                    ],
                    'segmentation': {
                        'separator': '\n',
                        'max_tokens': 500
                    }
                },
                'mode': 'custom'
            }
        }
        :return:
        """
        files = {"file": open(file_path, "rb")}
        data = {}
        if extra_params is not None and isinstance(extra_params, dict):
            data.update(extra_params)
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/update_by_file"
        return self._send_request_with_files("POST", url, {"data": json.dumps(data)}, files)

    def batch_indexing_status(self, batch_id: str, **kwargs):
        """
        Get the status of the batch indexing.

        :param batch_id: ID of the batch uploading
        :return: Response from the API
        """
        url = f"/datasets/{self._get_dataset_id()}/documents/{batch_id}/indexing-status"
        return self._send_request("GET", url, **kwargs)

    def delete_dataset(self):
        """
        Delete this dataset.

        :return: Response from the API
        """
        url = f"/datasets/{self._get_dataset_id()}"
        return self._send_request("DELETE", url)

    def delete_document(self, document_id: str):
        """
        Delete a document.

        :param document_id: ID of the document
        :return: Response from the API
        """
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}"
        return self._send_request("DELETE", url)

    def list_documents(
        self,
        page: int | None = None,
        page_size: int | None = None,
        keyword: str | None = None,
        **kwargs,
    ):
        """
        Get a list of documents in this dataset.

        :return: Response from the API
        """
        params = {}
        if page is not None:
            params["page"] = page
        if page_size is not None:
            params["limit"] = page_size
        if keyword is not None:
            params["keyword"] = keyword
        url = f"/datasets/{self._get_dataset_id()}/documents"
        return self._send_request("GET", url, params=params, **kwargs)

    def add_segments(self, document_id: str, segments: list[dict], **kwargs):
        """
        Add segments to a document.

        :param document_id: ID of the document
        :param segments: List of segments to add, example: [{"content": "1", "answer": "1", "keyword": ["a"]}]
        :return: Response from the API
        """
        data = {"segments": segments}
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/segments"
        return self._send_request("POST", url, json=data, **kwargs)

    def query_segments(
        self,
        document_id: str,
        keyword: str | None = None,
        status: str | None = None,
        **kwargs,
    ):
        """
        Query segments in this document.

        :param document_id: ID of the document
        :param keyword: query keyword, optional
        :param status: status of the segment, optional, e.g. completed
        """
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/segments"
        params = {}
        if keyword is not None:
            params["keyword"] = keyword
        if status is not None:
            params["status"] = status
        if "params" in kwargs:
            params.update(kwargs["params"])
        return self._send_request("GET", url, params=params, **kwargs)

    def delete_document_segment(self, document_id: str, segment_id: str):
        """
        Delete a segment from a document.

        :param document_id: ID of the document
        :param segment_id: ID of the segment
        :return: Response from the API
        """
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/segments/{segment_id}"
        return self._send_request("DELETE", url)

    def update_document_segment(self, document_id: str, segment_id: str, segment_data: dict, **kwargs):
        """
        Update a segment in a document.

        :param document_id: ID of the document
        :param segment_id: ID of the segment
        :param segment_data: Data of the segment, example: {"content": "1", "answer": "1", "keyword": ["a"], "enabled": True}
        :return: Response from the API
        """
        data = {"segment": segment_data}
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/segments/{segment_id}"
        return self._send_request("POST", url, json=data, **kwargs)

    # Advanced Knowledge Base APIs
    def hit_testing(
        self, query: str, retrieval_model: Dict[str, Any] = None, external_retrieval_model: Dict[str, Any] = None
    ):
        """Perform hit testing on the dataset."""
        data = {"query": query}
        if retrieval_model:
            data["retrieval_model"] = retrieval_model
        if external_retrieval_model:
            data["external_retrieval_model"] = external_retrieval_model
        url = f"/datasets/{self._get_dataset_id()}/hit-testing"
        return self._send_request("POST", url, json=data)

    def get_dataset_metadata(self):
        """Get dataset metadata."""
        url = f"/datasets/{self._get_dataset_id()}/metadata"
        return self._send_request("GET", url)

    def create_dataset_metadata(self, metadata_data: Dict[str, Any]):
        """Create dataset metadata."""
        url = f"/datasets/{self._get_dataset_id()}/metadata"
        return self._send_request("POST", url, json=metadata_data)

    def update_dataset_metadata(self, metadata_id: str, metadata_data: Dict[str, Any]):
        """Update dataset metadata."""
        url = f"/datasets/{self._get_dataset_id()}/metadata/{metadata_id}"
        return self._send_request("PATCH", url, json=metadata_data)

    def get_built_in_metadata(self):
        """Get built-in metadata."""
        url = f"/datasets/{self._get_dataset_id()}/metadata/built-in"
        return self._send_request("GET", url)

    def manage_built_in_metadata(self, action: str, metadata_data: Dict[str, Any] = None):
        """Manage built-in metadata with specified action."""
        data = metadata_data or {}
        url = f"/datasets/{self._get_dataset_id()}/metadata/built-in/{action}"
        return self._send_request("POST", url, json=data)

    def update_documents_metadata(self, operation_data: List[Dict[str, Any]]):
        """Update metadata for multiple documents."""
        url = f"/datasets/{self._get_dataset_id()}/documents/metadata"
        data = {"operation_data": operation_data}
        return self._send_request("POST", url, json=data)

    # Dataset Tags APIs
    def list_dataset_tags(self):
        """List all dataset tags."""
        return self._send_request("GET", "/datasets/tags")

    def bind_dataset_tags(self, tag_ids: List[str]):
        """Bind tags to dataset."""
        data = {"tag_ids": tag_ids, "target_id": self._get_dataset_id()}
        return self._send_request("POST", "/datasets/tags/binding", json=data)

    def unbind_dataset_tag(self, tag_id: str):
        """Unbind a single tag from dataset."""
        data = {"tag_id": tag_id, "target_id": self._get_dataset_id()}
        return self._send_request("POST", "/datasets/tags/unbinding", json=data)

    def get_dataset_tags(self):
        """Get tags for current dataset."""
        url = f"/datasets/{self._get_dataset_id()}/tags"
        return self._send_request("GET", url)

    # RAG Pipeline APIs
    def get_datasource_plugins(self, is_published: bool = True):
        """Get datasource plugins for RAG pipeline."""
        params = {"is_published": is_published}
        url = f"/datasets/{self._get_dataset_id()}/pipeline/datasource-plugins"
        return self._send_request("GET", url, params=params)

    def run_datasource_node(
        self,
        node_id: str,
        inputs: Dict[str, Any],
        datasource_type: str,
        is_published: bool = True,
        credential_id: str = None,
    ):
        """Run a datasource node in RAG pipeline."""
        data = {"inputs": inputs, "datasource_type": datasource_type, "is_published": is_published}
        if credential_id:
            data["credential_id"] = credential_id
        url = f"/datasets/{self._get_dataset_id()}/pipeline/datasource/nodes/{node_id}/run"
        return self._send_request("POST", url, json=data, stream=True)

    def run_rag_pipeline(
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
        return self._send_request("POST", url, json=data, stream=response_mode == "streaming")

    def upload_pipeline_file(self, file_path: str):
        """Upload file for RAG pipeline."""
        with open(file_path, "rb") as f:
            files = {"file": f}
            return self._send_request_with_files("POST", "/datasets/pipeline/file-upload", {}, files)
