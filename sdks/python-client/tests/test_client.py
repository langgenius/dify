import os
import unittest
from dify_client.client import ChatClient, CompletionClient, DifyClient

API_KEY = os.environ.get("API_KEY")
APP_ID = os.environ.get("APP_ID")


class TestChatClient(unittest.TestCase):
    def setUp(self):
        self.chat_client = ChatClient(API_KEY)

    def test_create_chat_message(self):
        response = self.chat_client.create_chat_message({}, "Hello, World!", "test_user")
        self.assertIn("message_id", response)

    def test_get_conversation_messages(self):
        response = self.chat_client.get_conversation_messages("test_user")
        self.assertIsInstance(response, list)

    def test_get_conversations(self):
        response = self.chat_client.get_conversations("test_user")
        self.assertIsInstance(response, list)


class TestCompletionClient(unittest.TestCase):
    def setUp(self):
        self.completion_client = CompletionClient(API_KEY)

    def test_create_completion_message(self):
        response = self.completion_client.create_completion_message({}, "What's the weather like today?", "blocking", "test_user")
        self.assertIn("message_id", response)


class TestDifyClient(unittest.TestCase):
    def setUp(self):
        self.dify_client = DifyClient(API_KEY)

    def test_message_feedback(self):
        response = self.dify_client.message_feedback("test_message_id", 5, "test_user")
        self.assertIn("success", response)

    def test_get_application_parameters(self):
        response = self.dify_client.get_application_parameters("test_user")
        self.assertIsInstance(response, dict)


if __name__ == "__main__":
    unittest.main()
