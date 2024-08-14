import requests


class DifyClient:
    def __init__(self, api_key, base_url: str = 'https://api.dify.ai/v1'):
        self.api_key = api_key
        self.base_url = base_url

    def _send_request(self, method, endpoint, json=None, params=None, stream=False):
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        url = f"{self.base_url}{endpoint}"
        response = requests.request(method, url, json=json, params=params, headers=headers, stream=stream)

        return response

    def _send_request_with_files(self, method, endpoint, data, files):
        headers = {
            "Authorization": f"Bearer {self.api_key}"
        }

        url = f"{self.base_url}{endpoint}"
        response = requests.request(method, url, data=data, headers=headers, files=files)

        return response

    def message_feedback(self, message_id, rating, user):
        data = {
            "rating": rating,
            "user": user
        }
        return self._send_request("POST", f"/messages/{message_id}/feedbacks", data)

    def get_application_parameters(self, user):
        params = {"user": user}
        return self._send_request("GET", "/parameters", params=params)

    def file_upload(self, user, files):
        data = {
            "user": user
        }
        return self._send_request_with_files("POST", "/files/upload", data=data, files=files)


class CompletionClient(DifyClient):
    def create_completion_message(self, inputs, response_mode, user, files=None):
        data = {
            "inputs": inputs,
            "response_mode": response_mode,
            "user": user,
            "files": files
        }
        return self._send_request("POST", "/completion-messages", data,
                                  stream=True if response_mode == "streaming" else False)


class ChatClient(DifyClient):
    def create_chat_message(self, inputs, query, user, response_mode="blocking", conversation_id=None, files=None):
        data = {
            "inputs": inputs,
            "query": query,
            "user": user,
            "response_mode": response_mode,
            "files": files
        }
        if conversation_id:
            data["conversation_id"] = conversation_id

        return self._send_request("POST", "/chat-messages", data,
                                  stream=True if response_mode == "streaming" else False)

    def get_conversation_messages(self, user, conversation_id=None, first_id=None, limit=None):
        params = {"user": user}

        if conversation_id:
            params["conversation_id"] = conversation_id
        if first_id:
            params["first_id"] = first_id
        if limit:
            params["limit"] = limit

        return self._send_request("GET", "/messages", params=params)

    def get_conversations(self, user, last_id=None, limit=None, pinned=None):
        params = {"user": user, "last_id": last_id, "limit": limit, "pinned": pinned}
        return self._send_request("GET", "/conversations", params=params)

    def rename_conversation(self, conversation_id, name, user):
        data = {"name": name, "user": user}
        return self._send_request("POST", f"/conversations/{conversation_id}/name", data)
