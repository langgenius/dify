from copy import deepcopy

import pytest
from pydantic import BaseModel

from controllers.console.datasets.datasets_document import DocumentDetailResponse as ConsoleDocumentDetailResponse
from fields.document_fields import DocumentResponse, DocumentSourceDetailResponse
from fields.service_api.document import DocumentDetailResponse as ServiceAPIDocumentDetailResponse
from libs.helper import dump_response

_PUBLIC_SOURCE_INFO: dict[str, object] = {
    "provider": "firecrawl",
    "job_id": "crawl-job-1",
    "upload_file_id": "upload-file-1",
}
_PRIVATE_CLEANUP_IDS = ["replaced-upload-1", "replaced-upload-2"]


@pytest.mark.parametrize(
    ("response_model", "payload", "source_field"),
    [
        (
            DocumentResponse,
            {
                "id": "document-1",
                "name": "Document",
                "data_source_info": {**_PUBLIC_SOURCE_INFO, "_pending_upload_cleanup_ids": _PRIVATE_CLEANUP_IDS},
                "data_source_detail_dict": {},
            },
            "data_source_info",
        ),
        (
            ConsoleDocumentDetailResponse,
            {
                "id": "document-1",
                "data_source_info": {**_PUBLIC_SOURCE_INFO, "_pending_upload_cleanup_ids": _PRIVATE_CLEANUP_IDS},
            },
            "data_source_info",
        ),
        (
            ServiceAPIDocumentDetailResponse,
            {
                "id": "document-1",
                "data_source_info": {**_PUBLIC_SOURCE_INFO, "_pending_upload_cleanup_ids": _PRIVATE_CLEANUP_IDS},
            },
            "data_source_info",
        ),
        (
            DocumentSourceDetailResponse,
            {**_PUBLIC_SOURCE_INFO, "_pending_upload_cleanup_ids": _PRIVATE_CLEANUP_IDS},
            None,
        ),
    ],
)
def test_document_source_responses_do_not_expose_cleanup_bookkeeping(
    response_model: type[BaseModel],
    payload: dict[str, object],
    source_field: str | None,
) -> None:
    original_payload = deepcopy(payload)

    response = dump_response(response_model, payload)
    public_source = response if source_field is None else response[source_field]

    assert public_source == _PUBLIC_SOURCE_INFO
    assert payload == original_payload
