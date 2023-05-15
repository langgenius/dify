import requests


class DifyClient:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.dify.ai/v1"

    def _send_request(self, method, endpoint, data=None, params=None, stream=False):
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        url = f"{self.base_url}{endpoint}"
        response = requests.request(method, url, json=data, params=params, headers=headers, stream=stream)

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


class CompletionClient(DifyClient):
    def create_completion_message(self, inputs, query, response_mode, user):
        data = {
            "inputs": inputs,
            "query": query,
            "response_mode": response_mode,
            "user": user
        }
        return self._send_request("POST", "/completion-messages", data, stream=True if response_mode == "streaming" else False)


class ChatClient(DifyClient):
    def create_chat_message(self, inputs, query, user, response_mode="blocking", conversation_id=None):
        data = {
            "inputs": inputs,
            "query": query,
            "user": user,
            "response_mode": response_mode
        }
        if conversation_id:
            data["conversation_id"] = conversation_id

        return self._send_request("POST", "/chat-messages", data, stream=True if response_mode == "streaming" else False)

    def get_conversation_messages(self, user, conversation_id=None, first_id=None, limit=None):
        params = {"user": user}

        if conversation_id:
            params["conversation_id"] = conversation_id
        if first_id:
            params["first_id"] = first_id
        if limit:
            params["limit"] = limit

        return self._send_request("GET", "/messages", params=params)

    def get_conversations(self, user, first_id=None, limit=None, pinned=None):
        params = {"user": user, "first_id": first_id, "limit": limit, "pinned": pinned}
        return self._send_request("GET", "/conversations", params=params)

    def rename_conversation(self, conversation_id, name, user):
        data = {"name": name, "user": user}
        return self._send_request("POST", f"/conversations/{conversation_id}/name", data)
