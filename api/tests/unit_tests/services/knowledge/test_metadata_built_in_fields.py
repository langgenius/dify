import time
from datetime import datetime

import pytest

from core.rag.index_processor.constant.built_in_field import BuiltInField
from models.dataset import build_built_in_field_values
from models.enums import DataSourceType
from services.knowledge import dataset_service
from services.knowledge.dataset_service import DocumentService
from tests.unit_tests.model_factories import make_account, make_dataset

CREATED_AT = datetime(2026, 10, 16, 8, 0, 0)
CREATED_AT_EPOCH = 1792137600


@pytest.fixture
def non_utc_host_timezone(monkeypatch):
    monkeypatch.setenv("TZ", "Asia/Tokyo")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


@pytest.mark.usefixtures("non_utc_host_timezone")
def test_build_built_in_field_values_treats_naive_datetimes_as_utc():
    values = build_built_in_field_values(
        document_name="doc.txt",
        uploader="Alice",
        upload_date=CREATED_AT,
        last_update_date=CREATED_AT,
        data_source_type=DataSourceType.UPLOAD_FILE,
    )

    assert values == {
        BuiltInField.document_name: "doc.txt",
        BuiltInField.uploader: "Alice",
        BuiltInField.upload_date: CREATED_AT_EPOCH,
        BuiltInField.last_update_date: CREATED_AT_EPOCH,
        BuiltInField.source: "file_upload",
    }


@pytest.mark.parametrize(
    ("data_source_type", "source"),
    [
        (DataSourceType.UPLOAD_FILE, "file_upload"),
        (DataSourceType.LOCAL_FILE, "file_upload"),
        (DataSourceType.NOTION_IMPORT, "notion"),
        (DataSourceType.WEBSITE_CRAWL, "website"),
        (DataSourceType.ONLINE_DOCUMENT, "online_document"),
        (DataSourceType.ONLINE_DRIVE, "online_drive"),
    ],
)
def test_build_built_in_field_values_maps_source_to_metadata_label(data_source_type, source):
    values = build_built_in_field_values(
        document_name="doc.txt",
        uploader=None,
        upload_date=CREATED_AT,
        last_update_date=CREATED_AT,
        data_source_type=data_source_type,
    )

    assert values[BuiltInField.source] == source


@pytest.mark.parametrize(
    "data_source_type",
    [DataSourceType.UPLOAD_FILE, DataSourceType.NOTION_IMPORT, DataSourceType.WEBSITE_CRAWL],
)
def test_build_document_writes_built_in_fields_in_shared_format(monkeypatch, data_source_type):
    monkeypatch.setattr(dataset_service, "naive_utc_now", lambda: CREATED_AT)
    dataset = make_dataset(built_in_field_enabled=True)

    document = DocumentService.build_document(
        dataset=dataset,
        process_rule_id=None,
        data_source_type=data_source_type,
        document_form="text_model",
        document_language="English",
        data_source_info={},
        created_from="web",
        position=1,
        account=make_account(name="Alice"),
        name="doc.txt",
        batch="batch-1",
    )

    assert document.doc_metadata == build_built_in_field_values(
        document_name="doc.txt",
        uploader="Alice",
        upload_date=CREATED_AT,
        last_update_date=CREATED_AT,
        data_source_type=data_source_type,
    )


def test_build_document_skips_built_in_fields_when_disabled():
    dataset = make_dataset(built_in_field_enabled=False)

    document = DocumentService.build_document(
        dataset=dataset,
        process_rule_id=None,
        data_source_type=DataSourceType.UPLOAD_FILE,
        document_form="text_model",
        document_language="English",
        data_source_info={},
        created_from="web",
        position=1,
        account=make_account(name="Alice"),
        name="doc.txt",
        batch="batch-1",
    )

    assert not document.doc_metadata
