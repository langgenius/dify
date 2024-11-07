import os
import time
import unittest
from types import GeneratorType

from dify_oapi.api.completion.v1.model.stop_completion_request import StopCompletionRequest
from dify_oapi.api.completion.v1.model.stop_completion_request_body import StopCompletionRequestBody
from dify_oapi.client import Client
from dify_oapi.core.model.request_option import RequestOption

from dify_oapi.api.completion.v1.model.completion_request import CompletionRequest
from dify_oapi.api.completion.v1.model.completion_request_body import CompletionRequestBody
from dify_oapi.api.completion.v1.model.completion_request_file import CompletionRequestFile
from dify_oapi.api.completion.v1.model.completion_request_body_input import CompletionRequestBodyInput


class TestCompletionClient(unittest.TestCase):
    def setUp(self):
        completion_key = os.environ.get("COMPLETION_KEY")
        self.assertIsNotNone(completion_key, "COMPLETION_KEY must be set")
        self.client = Client.builder().domain(os.environ.get("DOMAIN", "https://api.dify.ai")).build()
        self.req_option = RequestOption.builder().api_key(completion_key).build()

        self._message_id: str | None = None
        self._task_id: str | None = None

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

    def _test_001_block_chat(self):
        req_file = CompletionRequestFile.builder() \
            .type("image") \
            .transfer_method("remote_url") \
            .url("https://cloud.dify.ai/logo/logo-site.png") \
            .build()
        req_input = CompletionRequestBodyInput.builder() \
            .query("What are the specs of the iPhone 13 Pro Max?") \
            .build()
        req_body = CompletionRequestBody.builder() \
            .inputs(req_input) \
            .response_mode("blocking") \
            .user("abc-123") \
            .files([req_file]) \
            .build()
        req = CompletionRequest.builder().request_body(req_body).build()
        response = self.client.completion.v1.completion.completion(req, self.req_option, False)
        self.assertTrue(response.success, response.msg)
        self._message_id = response.message_id

    def _test_002_stream_chat(self):
        req_file = CompletionRequestFile.builder() \
            .type("image") \
            .transfer_method("remote_url") \
            .url("https://cloud.dify.ai/logo/logo-site.png") \
            .build()
        req_input = CompletionRequestBodyInput.builder() \
            .query("What are the specs of the iPhone 13 Pro Max?") \
            .build()
        req_body = CompletionRequestBody.builder() \
            .inputs(req_input) \
            .response_mode("streaming") \
            .user("abc-123") \
            .files([req_file]) \
            .build()
        req = CompletionRequest.builder().request_body(req_body).build()
        response = self.client.completion.v1.completion.completion(req, self.req_option, True)
        if not isinstance(response, GeneratorType):
            self.fail(response.msg)

    def _test_003_stop_chat(self):
        req_body = StopCompletionRequestBody.builder().user("abc-123").build()
        req = StopCompletionRequest.builder().request_body(req_body).task_id(self.task_id).build()
        response = self.client.completion.v1.completion.stop(req, self.req_option)
        self.assertTrue(response.success, response.msg)


if __name__ == "__main__":
    unittest.main()
