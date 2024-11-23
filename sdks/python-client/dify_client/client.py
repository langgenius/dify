import json

import requests


class DifyClient:
    def __init__(self, api_key, base_url: str = "https://api.dify.ai/v1"):
        self.api_key = api_key
        self.base_url = base_url

    def _send_request(self, method, endpoint, json=None, params=None, stream=False):
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        url = f"{self.base_url}{endpoint}"
        response = requests.request(
            method, url, json=json, params=params, headers=headers, stream=stream
        )

        return response

    def _send_request_with_files(self, method, endpoint, data, files):
        headers = {"Authorization": f"Bearer {self.api_key}"}

        url = f"{self.base_url}{endpoint}"
        response = requests.request(
            method, url, data=data, headers=headers, files=files
        )

        return response

    def message_feedback(self, message_id, rating, user):
        data = {"rating": rating, "user": user}
        return self._send_request("POST", f"/messages/{message_id}/feedbacks", data)

    def get_application_parameters(self, user):
        params = {"user": user}
        return self._send_request("GET", "/parameters", params=params)

    def file_upload(self, user, files):
        data = {"user": user}
        return self._send_request_with_files(
            "POST", "/files/upload", data=data, files=files
        )

    def text_to_audio(self, text: str, user: str, streaming: bool = False):
        data = {"text": text, "user": user, "streaming": streaming}
        return self._send_request("POST", "/text-to-audio", data=data)

    def get_meta(self, user):
        params = {"user": user}
        return self._send_request("GET", "/meta", params=params)


class CompletionClient(DifyClient):
    def create_completion_message(self, inputs, response_mode, user, files=None):
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
        inputs,
        query,
        user,
        response_mode="blocking",
        conversation_id=None,
        files=None,
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

    def get_suggested(self, message_id, user: str):
        params = {"user": user}
        return self._send_request(
            "GET", f"/messages/{message_id}/suggested", params=params
        )

    def stop_message(self, task_id, user):
        data = {"user": user}
        return self._send_request("POST", f"/chat-messages/{task_id}/stop", data)

    def get_conversations(self, user, last_id=None, limit=None, pinned=None):
        params = {"user": user, "last_id": last_id, "limit": limit, "pinned": pinned}
        return self._send_request("GET", "/conversations", params=params)

    def get_conversation_messages(
        self, user, conversation_id=None, first_id=None, limit=None
    ):
        params = {"user": user}

        if conversation_id:
            params["conversation_id"] = conversation_id
        if first_id:
            params["first_id"] = first_id
        if limit:
            params["limit"] = limit

        return self._send_request("GET", "/messages", params=params)

    def rename_conversation(
        self, conversation_id, name, auto_generate: bool, user: str
    ):
        data = {"name": name, "auto_generate": auto_generate, "user": user}
        return self._send_request(
            "POST", f"/conversations/{conversation_id}/name", data
        )

    def delete_conversation(self, conversation_id, user):
        data = {"user": user}
        return self._send_request("DELETE", f"/conversations/{conversation_id}", data)

    def audio_to_text(self, audio_file, user):
        data = {"user": user}
        files = {"audio_file": audio_file}
        return self._send_request_with_files("POST", "/audio-to-text", data, files)


class WorkflowClient(DifyClient):
    def run(
        self, inputs: dict, response_mode: str = "streaming", user: str = "abc-123"
    ):
        data = {"inputs": inputs, "response_mode": response_mode, "user": user}
        return self._send_request("POST", "/workflows/run", data)

    def stop(self, task_id, user):
        data = {"user": user}
        return self._send_request("POST", f"/workflows/tasks/{task_id}/stop", data)

    def get_result(self, workflow_run_id):
        return self._send_request("GET", f"/workflows/run/{workflow_run_id}")


class KnowledgeBaseClient(DifyClient):
    def __init__(
        self, api_key, base_url: str = "https://api.dify.ai/v1", dataset_id: str = None
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
        return self._send_request(
            "GET", f"/datasets?page={page}&limit={page_size}", **kwargs
        )

    def create_document_by_text(self, name, text, extra_params: dict = None, **kwargs):
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
        self, document_id, name, text, extra_params: dict = None, **kwargs
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
        url = (
            f"/datasets/{self._get_dataset_id()}/documents/{document_id}/update_by_text"
        )
        return self._send_request("POST", url, json=data, **kwargs)

    def create_document_by_file(
        self, file_path, original_document_id=None, extra_params: dict = None
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
        return self._send_request_with_files(
            "POST", url, {"data": json.dumps(data)}, files
        )

    def update_document_by_file(
        self, document_id, file_path, extra_params: dict = None
    ):
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
        url = (
            f"/datasets/{self._get_dataset_id()}/documents/{document_id}/update_by_file"
        )
        return self._send_request_with_files(
            "POST", url, {"data": json.dumps(data)}, files
        )

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

    def delete_document(self, document_id):
        """
        Delete a document.

        :param document_id: ID of the document
        :return: Response from the API
        """
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}"
        return self._send_request("DELETE", url)

    def list_documents(
        self, page: int = None, page_size: int = None, keyword: str = None, **kwargs
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

    def add_segments(self, document_id, segments, **kwargs):
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
        self, document_id, keyword: str = None, status: str = None, **kwargs
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

    def delete_document_segment(self, document_id, segment_id):
        """
        Delete a segment from a document.

        :param document_id: ID of the document
        :param segment_id: ID of the segment
        :return: Response from the API
        """
        url = f"/datasets/{self._get_dataset_id()}/documents/{document_id}/segments/{segment_id}"
        return self._send_request("DELETE", url)

    def update_document_segment(self, document_id, segment_id, segment_data, **kwargs):
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
