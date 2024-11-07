import os
import time
import unittest
from io import BytesIO
from pathlib import Path
from types import GeneratorType

from dify_oapi.api.chat.v1.model.audio_to_text_request import AudioToTextRequest
from dify_oapi.api.chat.v1.model.audio_to_text_request_body import AudioToTextRequestBody
from dify_oapi.api.chat.v1.model.chat_request import ChatRequest
from dify_oapi.api.chat.v1.model.chat_request_body import ChatRequestBody
from dify_oapi.api.chat.v1.model.chat_request_file import ChatRequestFile
from dify_oapi.api.chat.v1.model.delete_conversation_request import DeleteConversationRequest
from dify_oapi.api.chat.v1.model.delete_conversation_request_body import DeleteConversationRequestBody
from dify_oapi.api.chat.v1.model.get_conversation_list_request import GetConversationListRequest
from dify_oapi.api.chat.v1.model.message_history_request import MessageHistoryRequest
from dify_oapi.api.chat.v1.model.message_suggested_request import MessageSuggestedRequest
from dify_oapi.api.chat.v1.model.rename_conversation_request import RenameConversationRequest
from dify_oapi.api.chat.v1.model.rename_conversation_request_body import RenameConversationRequestBody
from dify_oapi.api.chat.v1.model.stop_chat_request import StopChatRequest
from dify_oapi.api.chat.v1.model.stop_chat_request_body import StopChatRequestBody
from dify_oapi.client import Client
from dify_oapi.core.model.request_option import RequestOption


class TestChatClient(unittest.TestCase):
    def setUp(self):
        chat_key = os.environ.get("CHAT_KEY")
        self.assertIsNotNone(chat_key, "CHAT_KEY must be set")
        self.client = Client.builder().domain(os.environ.get("DOMAIN", "https://api.dify.ai")).build()
        self.req_option = RequestOption.builder().api_key(chat_key).build()

        self._audio_file_path = Path(__file__) / "audio.mp3"
        self._conversation_id: str | None = None
        self._message_id: str | None = None
        self._task_id: str | None = None

    @property
    def audio_file_path(self) -> Path:
        if not self._audio_file_path.exists():
            self.skipTest("Audio file not found.")
        return self._audio_file_path

    @property
    def conversation_id(self) -> str:
        if self._conversation_id is None:
            self.skipTest("conversation_id is not set")
        return self._conversation_id

    @property
    def message_id(self) -> str:
        if self._message_id is None:
            self.skipTest("message_id is not set")
        return self._message_id

    @property
    def task_id(self) -> str:
        if self._task_id is None:
            self.skipTest("task_id is not set")
        return self._task_id

    def test_main(self):
        self._test_001_block_chat()
        time.sleep(0.5)
        self._test_002_stream_chat()
        time.sleep(0.5)
        self._test_003_stop_chat()
        time.sleep(0.5)
        self._test_004_suggest_message()
        time.sleep(0.5)
        self._test_005_message_history()
        time.sleep(0.5)
        self._test_006_list_conversations()
        time.sleep(0.5)
        self._test_007_rename_conversation()
        time.sleep(0.5)
        self._test_008_delete_conversation()
        time.sleep(0.5)
        self._test_009_audio_to_text()
        time.sleep(0.5)

    def _test_001_block_chat(self):
        req_file = ChatRequestFile.builder() \
            .type("image") \
            .transfer_method("remote_url") \
            .url("https://cloud.dify.ai/logo/logo-site.png") \
            .build()
        req_body = ChatRequestBody.builder() \
            .inputs({}) \
            .query("What are the specs of the iPhone 13 Pro Max?") \
            .response_mode("blocking") \
            .user("abc-123") \
            .files([req_file]) \
            .build()
        req = ChatRequest.builder().request_body(req_body).build()
        response = self.client.chat.v1.chat.chat(req, self.req_option, False)
        self.assertTrue(response.success, response.msg)
        self._conversation_id = response.conversation_id
        self._message_id = response.message_id

    def _test_002_stream_chat(self):
        req_file = ChatRequestFile.builder() \
            .type("image") \
            .transfer_method("remote_url") \
            .url("https://cloud.dify.ai/logo/logo-site.png") \
            .build()
        req_body = ChatRequestBody.builder() \
            .inputs({}) \
            .query("What are the specs of the iPhone 13 Pro Max?") \
            .response_mode("streaming") \
            .user("abc-123") \
            .files([req_file]) \
            .build()
        req = ChatRequest.builder().request_body(req_body).build()
        response = self.client.chat.v1.chat.chat(req, self.req_option, True)
        if not isinstance(response, GeneratorType):
            self.fail(response.msg)

    def _test_003_stop_chat(self):
        req_body = StopChatRequestBody.builder().user("abc-123").build()
        req = StopChatRequest.builder().request_body(req_body).task_id(self.task_id).build()
        response = self.client.chat.v1.chat.stop(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_004_suggest_message(self):
        req = MessageSuggestedRequest.builder().user("abc-123").message_id(self.message_id).build()
        response = self.client.chat.v1.message.suggested(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_005_message_history(self):
        req = MessageHistoryRequest.builder().user("abc-123").conversation_id(self.conversation_id).build()
        response = self.client.chat.v1.message.history(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_006_list_conversations(self):
        req = GetConversationListRequest.builder().user("abc-123").build()
        response = self.client.chat.v1.conversation.list(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_007_rename_conversation(self):
        req_body = RenameConversationRequestBody.builder().user("abc-123").name("newname").builder()
        req = RenameConversationRequest.builder().request_body(req_body).conversation_id(self.conversation_id).build()
        response = self.client.chat.v1.conversation.rename(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_008_delete_conversation(self):
        req_body = DeleteConversationRequestBody.builder().user("abc-123").build()
        req = DeleteConversationRequest.builder().conversation_id(self.conversation_id).request_body(req_body).build()
        response = self.client.chat.v1.conversation.delete(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_009_audio_to_text(self):
        req_body = AudioToTextRequestBody.builder().user("abc-123").build()
        with self.audio_file_path.open(mode="rb") as f:
            data = f.read()
        req = AudioToTextRequest.builder().request_body(req_body).file(BytesIO(data), self.audio_file_path.name).build()
        response = self.client.chat.v1.audio.to_text(req, self.req_option)
        self.assertTrue(response.success, response.msg)


if __name__ == "__main__":
    unittest.main()
