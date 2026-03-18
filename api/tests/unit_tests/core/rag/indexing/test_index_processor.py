from unittest.mock import Mock, patch

from core.rag.index_processor.index_processor import IndexProcessor
from models.dataset import DatasetMetadataBinding


def test_save_doc_metadata_and_bindings_replaces_removed_metadata_and_bindings():
    processor = IndexProcessor()
    session = Mock()

    new_metadata = Mock()
    new_metadata.id = "meta-new"
    new_metadata.name = "new_field"

    old_metadata = Mock()
    old_metadata.id = "meta-old"
    old_metadata.name = "old_field"

    old_binding = Mock(spec=DatasetMetadataBinding)
    old_binding.metadata_id = "meta-old"

    first_scalars_result = Mock()
    first_scalars_result.all.return_value = [new_metadata]
    second_scalars_result = Mock()
    second_scalars_result.all.return_value = [old_binding]
    third_scalars_result = Mock()
    third_scalars_result.all.return_value = [old_metadata, new_metadata]
    session.scalars.side_effect = [
        first_scalars_result,
        second_scalars_result,
        third_scalars_result,
    ]

    delete_query = Mock()
    delete_where = Mock()
    delete_where.delete.return_value = 1
    delete_query.where.return_value = delete_where
    session.query.return_value = delete_query

    document = Mock()
    document.id = "doc-1"
    document.doc_metadata = {
        "old_field": "stale",
        "keep_field": "keep",
    }

    with patch("core.rag.index_processor.index_processor.attributes.flag_modified"):
        processor._save_doc_metadata_and_bindings(
            session=session,
            dataset_id="dataset-1",
            tenant_id="tenant-1",
            document=document,
            doc_metadata={"meta-new": "new_value"},
            metadata_binding_ids=["meta-new"],
            user_id="user-1",
        )

    assert document.doc_metadata == {
        "keep_field": "keep",
        "new_field": "new_value",
    }
    delete_where.delete.assert_called_once_with(synchronize_session=False)

    binding_instance = session.add.call_args_list[0].args[0]
    assert isinstance(binding_instance, DatasetMetadataBinding)
    assert binding_instance.document_id == "doc-1"
    assert binding_instance.metadata_id == "meta-new"
