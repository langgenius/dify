import os
import unittest
from io import BytesIO
from pathlib import Path

from dify_oapi.api.dify.v1.model.get_info_request import GetInfoRequest
from dify_oapi.api.dify.v1.model.get_parameter_request import GetParameterRequest
from dify_oapi.api.dify.v1.model.message_feedback_request import MessageFeedbackRequest
from dify_oapi.api.dify.v1.model.message_feedback_request_body import MessageFeedbackRequestBody
from dify_oapi.api.dify.v1.model.upload_file_request import UploadFileRequest
from dify_oapi.api.dify.v1.model.upload_file_body import UploadFileBody

from dify_oapi.api.dify.v1.model.get_meta_request import GetMetaRequest
from dify_oapi.api.dify.v1.model.text_to_audio_request import TextToAudioRequest
from dify_oapi.api.dify.v1.model.text_to_audio_request_body import (
    TextToAudioRequestBody,
)
from dify_oapi.client import Client
from dify_oapi.core.model.request_option import RequestOption


class TestDifyClient(unittest.TestCase):

    def setUp(self):
        app_key = os.environ.get("APP_KEY")
        self.assertIsNotNone(app_key, "APP_KEY must be set")
        self.client = Client.builder().domain(os.environ.get("DOMAIN", "https://api.dify.ai")).build()
        self.req_option = RequestOption.builder().api_key(app_key).build()

        self.readme_file_path = Path(__file__).parents[1] / "README.md"
        self._message_id: str | None = None

    @property
    def message_id(self):
        if self._message_id is None:
            self.skipTest("Message id not set")
        return self._message_id

    def test_upload_file(self):
        req_body = UploadFileBody.builder().user("abc-123").build()
        with self.readme_file_path.open("rb") as f:
            data = f.read()
        req = UploadFileRequest.builder().request_body(req_body).file(BytesIO(data), self.readme_file_path.name).build()
        response = self.client.dify.v1.file.upload(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def test_get_meta(self):
        req = GetMetaRequest.builder().user("abc-123").build()
        response = self.client.dify.v1.meta.get(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def test_text_to_audio(self):
        req_body = TextToAudioRequestBody.builder().user("abc-123").text("Hello Dify").build()
        req = TextToAudioRequest.builder().request_body(req_body).build()
        response = self.client.dify.v1.audio.from_text(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def test_get_parameter(self):
        req = GetParameterRequest.builder().user("abc-123").build()
        response = self.client.dify.v1.parameter.get(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def test_message_feedback(self):
        req_body = MessageFeedbackRequestBody.builder().user("abc-123").rating("like").build()
        req = MessageFeedbackRequest.builder().message_id(self.message_id).request_body(req_body).build()
        response = self.client.dify.v1.message.feedback(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def test_get_info(self):
        req = GetInfoRequest.builder().user("abc-123").build()
        response = self.client.dify.v1.info.get(req, self.req_option)
        self.assertTrue(response.success, response.msg)


if __name__ == "__main__":
    unittest.main()
