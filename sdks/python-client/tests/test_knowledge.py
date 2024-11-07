import os
import time
import unittest
from pathlib import Path
from io import BytesIO

from dify_oapi.api.knowledge_base.v1.model.create_dataset_request import CreateDatasetRequest
from dify_oapi.api.knowledge_base.v1.model.create_dataset_request_body import CreateDatasetRequestBody
from dify_oapi.api.knowledge_base.v1.model.list_dataset_request import ListDatasetRequest
from dify_oapi.api.knowledge_base.v1.model.delete_dataset_request import DeleteDatasetRequest
from dify_oapi.api.knowledge_base.v1.model.hit_test_request import HitTestRequest
from dify_oapi.api.knowledge_base.v1.model.hit_test_request_body import HitTestRequestBody
from dify_oapi.api.knowledge_base.v1.model.index_status_request import IndexStatusRequest
from dify_oapi.api.knowledge_base.v1.model.create_document_by_text_request import CreateDocumentByTextRequest
from dify_oapi.api.knowledge_base.v1.model.create_document_by_text_request_body import CreateDocumentByTextRequestBody
from dify_oapi.api.knowledge_base.v1.model.document_request_process_rule import DocumentRequestProcessRule
from dify_oapi.api.knowledge_base.v1.model.create_document_by_file_request import CreateDocumentByFileRequest
from dify_oapi.api.knowledge_base.v1.model.create_document_by_file_request_body import CreateDocumentByFileRequestBody
from dify_oapi.api.knowledge_base.v1.model.create_document_by_file_request_body_data import CreateDocumentByTextRequestBodyData
from dify_oapi.api.knowledge_base.v1.model.update_document_by_text_request import UpdateDocumentByTextRequest
from dify_oapi.api.knowledge_base.v1.model.update_document_by_text_request_body import UpdateDocumentByTextRequestBody
from dify_oapi.api.knowledge_base.v1.model.delete_document_request import DeleteDocumentRequest
from dify_oapi.api.knowledge_base.v1.model.list_document_request import ListDocumentRequest
from dify_oapi.api.knowledge_base.v1.model.list_segment_request import ListSegmentRequest
from dify_oapi.api.knowledge_base.v1.model.create_segment_request import CreateSegmentRequest
from dify_oapi.api.knowledge_base.v1.model.create_segment_request_body import CreateSegmentRequestBody
from dify_oapi.api.knowledge_base.v1.model.create_segment_request_body_segment import CreateSegmentRequestBodySegment
from dify_oapi.api.knowledge_base.v1.model.delete_segment_request import DeleteSegmentRequest
from dify_oapi.api.knowledge_base.v1.model.update_segment_request import UpdateSegmentRequest
from dify_oapi.api.knowledge_base.v1.model.update_segment_request_body import UpdateSegmentRequestBody
from dify_oapi.api.knowledge_base.v1.model.update_segment_request_body_segment import UpdateSegmentRequestBodySegment
from dify_oapi.client import Client
from dify_oapi.core.model.request_option import RequestOption


class TestKnowledgeBaseClient(unittest.TestCase):
    def setUp(self):
        dataset_key = os.environ.get("DATASET_KEY")
        self.assertNotIn(dataset_key, [None, ""], "DATASET_KEY must be set")
        self.client = Client.builder().domain(os.environ.get("DOMAIN", "https://api.dify.ai")).build()
        self.req_option = RequestOption.builder().api_key(dataset_key).build()

        self.readme_file_path = Path(__file__).parents[1] / "README.md"
        self._dataset_id: str | None = None
        self._document_id: str | None = None
        self._batch: str | None = None
        self._segment_id: str | None = None

    @property
    def dataset_id(self):
        if self._dataset_id is None:
            self.skipTest("Dataset key is not set")
        return self._dataset_id

    @property
    def document_id(self):
        if self._document_id is None:
            self.skipTest("Document key is not set")
        return self._document_id

    @property
    def batch(self):
        if self._batch is None:
            self.skipTest("Batch is not set")
        return self._batch

    @property
    def segment_id(self):
        if self._segment_id is None:
            self.skipTest("Segment key is not set")
        return self._segment_id

    def tearDown(self):
        if self._dataset_id is not None:
            self._test_014_delete_dataset()
            
    def test_main(self):
        self._test_001_create_dataset()
        time.sleep(0.5)
        self._test_002_list_dataset()
        time.sleep(0.5)
        self._test_003_create_document_by_text()
        time.sleep(0.5)
        self._test_004_create_document_by_file()
        time.sleep(0.5)
        self._test_005_update_document_by_text()
        time.sleep(0.5)
        self._test_006_list_document()
        time.sleep(0.5)
        self._test_007_create_segment()
        time.sleep(0.5)
        self._test_008_list_segment()
        time.sleep(0.5)
        self._test_009_update_segment()
        # time.sleep(0.5)
        # self._test_010_hit_status()
        time.sleep(0.5)
        self._test_011_index_status()
        time.sleep(0.5)
        self._test_012_delete_segment()
        time.sleep(0.5)
        self._test_013_delete_document()
        time.sleep(0.5)
        self._test_014_delete_dataset()

    def _test_001_create_dataset(self):
        req_body = CreateDatasetRequestBody.builder().name("test").build()
        req = CreateDatasetRequest.builder().request_body(req_body).build()
        response = self.client.knowledge_base.v1.dataset.create(req, self.req_option)
        self.assertTrue(response.success, response.msg)
        self._dataset_id = response.id

    def _test_002_list_dataset(self):
        req = ListDatasetRequest.builder().build()
        response = self.client.knowledge_base.v1.dataset.list(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_003_create_document_by_text(self):
        document_process_rule = DocumentRequestProcessRule.builder().mode("automatic").build()
        req_body = CreateDocumentByTextRequestBody.builder() \
            .indexing_technique("economy") \
            .text("imtext") \
            .name("imname") \
            .process_rule(document_process_rule) \
            .build()
        req = CreateDocumentByTextRequest.builder().dataset_id(self.dataset_id).request_body(req_body).build()
        response = self.client.knowledge_base.v1.document.create_by_text(req, self.req_option)
        self.assertTrue(response.success, response.msg)
        self._document_id = response.document.id
        self._batch = response.batch

    def _test_004_create_document_by_file(self):
        document_process_rule = DocumentRequestProcessRule.builder().mode("automatic").build()
        data = CreateDocumentByTextRequestBodyData.builder().process_rule(document_process_rule).build()
        req_body = CreateDocumentByFileRequestBody.builder().data(data).build()
        with self.readme_file_path.open(mode="rb") as f:
            data = f.read()
        req = CreateDocumentByFileRequest.builder() \
            .dataset_id(self.dataset_id) \
            .request_body(req_body).file(BytesIO(data), self.readme_file_path.name) \
            .build()
        response = self.client.knowledge_base.v1.document.create_by_file(req, self.req_option)
        self.assertTrue(response.success, response.msg)
        self._batch = response.batch
        self._document_id = response.document.id

    def _test_005_update_document_by_text(self):
        req_body = UpdateDocumentByTextRequestBody.builder().text("imtext2").name("imname2").build()
        req = UpdateDocumentByTextRequest.builder() \
            .request_body(req_body) \
            .dataset_id(self.dataset_id) \
            .document_id(self.document_id) \
            .build()
        response = self.client.knowledge_base.v1.document.update_by_text(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_006_list_document(self):
        req = ListDocumentRequest.builder().dataset_id(self.dataset_id).build()
        response = self.client.knowledge_base.v1.document.list(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_007_create_segment(self):
        segment = CreateSegmentRequestBodySegment.builder().content("im segment content").keywords(["content"]).build()
        req_body = CreateSegmentRequestBody.builder().segments([segment]).build()
        req = CreateSegmentRequest.builder() \
            .request_body(req_body) \
            .dataset_id(self.dataset_id) \
            .document_id(self.document_id) \
            .build()
        response = self.client.knowledge_base.v1.segment.create(req, self.req_option)
        self.assertTrue(response.success, response.msg)
        self._segment_id = response.data[0].id

    def _test_008_list_segment(self):
        req = ListSegmentRequest.builder().dataset_id(self.dataset_id).document_id(self.document_id).build()
        response = self.client.knowledge_base.v1.segment.list(req, self.req_option)
        self.assertTrue(response.success, response.msg)
        if self._segment_id is None and len(response.data) > 0:
            self._segment_id = response.data[0].id

    def _test_009_update_segment(self):
        segment = UpdateSegmentRequestBodySegment.builder().content("im segment content2").build()
        req_body = UpdateSegmentRequestBody.builder().segment(segment).build()
        req = UpdateSegmentRequest.builder() \
            .request_body(req_body) \
            .dataset_id(self.dataset_id) \
            .document_id(self.document_id) \
            .segment_id(self.segment_id) \
            .build()
        response = self.client.knowledge_base.v1.segment.update(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_010_hit_status(self):
        req_body = HitTestRequestBody.builder().query("hello dify").build()
        req = HitTestRequest.builder().dataset_id(self.dataset_id).request_body(req_body).build()
        response = self.client.knowledge_base.v1.dataset.hit_test(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_011_index_status(self):
        req = IndexStatusRequest.builder().dataset(self.dataset_id).batch(self.batch).build()
        response = self.client.knowledge_base.v1.document.indexing_status(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_012_delete_segment(self):
        req = DeleteSegmentRequest.builder() \
            .dataset_id(self.dataset_id) \
            .document_id(self.document_id) \
            .segment_id(self.segment_id) \
            .build()
        response = self.client.knowledge_base.v1.segment.delete(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_013_delete_document(self):
        req = DeleteDocumentRequest.builder().dataset_id(self.dataset_id).document_id(self.document_id).build()
        response = self.client.knowledge_base.v1.document.delete(req, self.req_option)
        self.assertTrue(response.success, response.msg)

    def _test_014_delete_dataset(self):
        req = DeleteDatasetRequest.builder().dataset_id(self.dataset_id).build()
        delete_response = self.client.knowledge_base.v1.dataset.delete(request=req, option=self.req_option)
        self.assertTrue(delete_response.success, delete_response.msg)
        self._dataset_id = None


if __name__ == "__main__":
    unittest.main()
