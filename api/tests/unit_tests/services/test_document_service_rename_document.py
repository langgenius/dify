from types import SimpleNamespace
from unittest.mock import Mock


def make_dataset(dataset_id="dataset-123", tenant_id="tenant-123", built_in_field_enabled=False):
    return SimpleNamespace(id=dataset_id, tenant_id=tenant_id, built_in_field_enabled=built_in_field_enabled)


def make_document(
    document_id="document-123",
    dataset_id="dataset-123",
    tenant_id="tenant-123",
    name="Old Name",
    data_source_info=None,
    doc_metadata=None,
):
    doc = Mock()
    doc.id = document_id
    doc.dataset_id = dataset_id
    doc.tenant_id = tenant_id
    doc.name = name
    doc.data_source_info = data_source_info or {}
    # property-like usage in code relies on a dict
    doc.data_source_info_dict = dict(doc.data_source_info)
    doc.doc_metadata = dict(doc_metadata or {})
    return doc


def test_make_dataset_helper_defaults():
    dataset = make_dataset()

    assert dataset.id == "dataset-123"
    assert dataset.tenant_id == "tenant-123"
    assert dataset.built_in_field_enabled is False


def test_make_document_helper_defaults():
    document = make_document()

    assert document.id == "document-123"
    assert document.dataset_id == "dataset-123"
    assert document.tenant_id == "tenant-123"
    assert document.name == "Old Name"
    assert document.data_source_info_dict == {}
    assert document.doc_metadata == {}
