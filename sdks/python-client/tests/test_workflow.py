import os
import time
import unittest
from types import GeneratorType

from dify_oapi.api.workflow.v1.model.get_workflow_log_request import GetWorkflowLogRequest
from dify_oapi.api.workflow.v1.model.get_workflow_result_request import GetWorkflowResultRequest
from dify_oapi.api.workflow.v1.model.run_workflow_request import RunWorkflowRequest
from dify_oapi.api.workflow.v1.model.run_workflow_request_body import RunWorkflowRequestBody
from dify_oapi.api.workflow.v1.model.run_workflow_request_file import RunWorkflowRequestFile
from dify_oapi.api.workflow.v1.model.stop_workflow_request import StopWorkflowRequest
from dify_oapi.api.workflow.v1.model.stop_workflow_request_body import StopWorkflowRequestBody
from dify_oapi.client import Client
from dify_oapi.core.model.request_option import RequestOption


class TestChatClient(unittest.TestCase):
    def setUp(self):
        workflow_key = os.environ.get("WORKFLOW_KEY")
        self.assertIsNotNone(workflow_key, "WORKFLOW_KEY must be set")
        self.client = Client.builder().domain(os.environ.get("DOMAIN", "https://api.dify.ai")).build()
        self.req_option = RequestOption.builder().api_key(workflow_key).build()

        self._workflow_id: str | None = None
        self._task_id: str | None = None

    @property
    def workflow_id(self):
        if self._workflow_id is None:
            self.skipTest("workflow_id is not set")
        return self._workflow_id

    @property
    def task_id(self):
        if self._task_id is None:
            self.skipTest("task_id is not set")
        return self._task_id

    def test_main(self):
        self._test_001_block_workflow()
        time.sleep(0.5)
        self._test_002_stream_workflow()
        time.sleep(0.5)
        self._test_003_result()
        time.sleep(0.5)
        self._test_005_log()

    def _test_001_block_workflow(self):
        req_file = RunWorkflowRequestFile.builder() \
            .type("image") \
            .transfer_method("remote_url") \
            .url("https://cloud.dify.ai/logo/logo-site.png") \
            .build()
        req_body = RunWorkflowRequestBody.builder() \
            .inputs({}) \
            .response_mode("blocking") \
            .user("abc-123") \
            .files([req_file]) \
            .build()
        req = RunWorkflowRequest.builder().request_body(req_body).build()
        response = self.client.workflow.v1.workflow.run(req, self.req_option, False)
        self.assertTrue(response.success, response.msg)
        self._workflow_id = response.workflow_run_id
        self._task_id = response.task_id

    def _test_002_stream_workflow(self):
        req_file = RunWorkflowRequestFile.builder() \
            .type("image") \
            .transfer_method("remote_url") \
            .url("https://cloud.dify.ai/logo/logo-site.png") \
            .build()
        req_body = RunWorkflowRequestBody.builder() \
            .inputs({}) \
            .response_mode("streaming") \
            .user("abc-123") \
            .files([req_file]) \
            .build()
        req = RunWorkflowRequest.builder().request_body(req_body).build()
        response = self.client.workflow.v1.workflow.run(req, self.req_option, True)
        if not isinstance(response, GeneratorType):
            self.fail(response.msg)

    def _test_003_result(self):
        req = GetWorkflowResultRequest.builder().workflow_id(self.workflow_id).build()
        response = self.client.workflow.v1.workflow.result(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_004_stop(self):
        req_body = StopWorkflowRequestBody.builder().user("abc-123").build()
        req = StopWorkflowRequest.builder().request_body(req_body).task_id(self.task_id).build()
        response = self.client.workflow.v1.workflow.stop(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_005_log(self):
        req = GetWorkflowLogRequest.builder().status("succeeded").page(1).limit(10).build()
        response = self.client.workflow.v1.workflow.log(req, self.req_option)
        self.assertTrue(response.success, response.msg)


if __name__ == "__main__":
    unittest.main()
