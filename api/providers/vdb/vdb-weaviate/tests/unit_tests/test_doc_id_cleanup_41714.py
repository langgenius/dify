"""Regression tests for issue #41714.

The pre-fix code generated Weaviate object ids via
``uuid5(URL_NAMESPACE, page_content)`` (UUID v5 from content). The
cleanup path (``batch_clean_document_task`` -> ``index_processor.clean``
-> ``vector.delete_by_ids``) passes the segment's ``index_node_id``
(random UUID v4 from the database), so the two never agreed and
``delete_by_id`` silently no-op'd on every cleanup pass.

The fix:

1. ``_get_uuids`` now uses the segment's ``doc_id`` (== ``index_node_id``)
   from each document's metadata. New objects line up with the
   cleanup path one-for-one.
2. Documents without a ``doc_id`` keep a stable slot via a freshly
   generated ``uuid4`` so the parallel ``objs`` list in ``add_texts``
   never goes out of alignment with the input documents.
3. ``delete_by_ids`` keeps the best-effort direct-UUID delete (the
   fresh-write path), then falls through to a ``doc_id``-metadata
   ``contains_any`` filter so the legacy UUID5 objects are reaped
   too -- backwards-compatible with the rows already in production.
"""

from unittest.mock import MagicMock, patch

from dify_vdb_weaviate import weaviate_vector as weaviate_vector_module
from dify_vdb_weaviate.weaviate_vector import WeaviateVector

from core.rag.models.document import Document


class _FakeUnexpectedStatusCodeError(Exception):
    """Stand-in for ``weaviate.exceptions.UnexpectedStatusCodeError``.

    The real class has a read-only ``status_code`` property; the
    production code only reads ``.status_code`` off the exception, so
    a plain attribute is enough. We patch the module-level reference
    in the production module so the ``except`` clause catches ours.
    """

    def __init__(self, status_code: int) -> None:
        super().__init__(f"status={status_code}")
        self.status_code = status_code


def _make_vector() -> tuple[WeaviateVector, MagicMock]:
    """Build a ``WeaviateVector`` without invoking ``__init__`` so we
    never reach ``_init_client`` (which would try to connect).

    Only ``_client`` and ``_collection_name`` are touched by the
    production code paths exercised here (``_get_uuids`` and
    ``delete_by_ids``), so the rest of the instance dict is left bare.

    Returns the ``WeaviateVector`` together with its mocked client so
    tests can reach ``client.collections.use(...).data`` (the same
    path the production code walks) without pyrefly tripping over
    chained ``.return_value`` access through the dynamic ``_client``
    instance attribute.
    """
    # pyrefly cannot resolve chained ``.return_value`` access through
    # dynamically-attached attributes (it infers ``v._client`` as the
    # missing-on-class attribute and falls through to the stdlib
    # ``collections`` module), so keep the mocked client in a local
    # variable whose type pyrefly can see.
    client: MagicMock = MagicMock()
    client.collections.exists.return_value = True
    client.collections.use.return_value = client.data

    v = WeaviateVector.__new__(WeaviateVector)
    v._collection_name = "Test_Collection"
    v._client = client
    return v, client


def _collection(client: MagicMock) -> MagicMock:
    """Resolve ``client.collections.use().data`` as a typed MagicMock.

    Centralised so the same ``client.data`` instance is reused -- the
    production code reaches the Weaviate collection's ``data`` object
    via ``v._client.collections.use(name).data``; we mirror that path
    so ``delete_by_id`` / ``delete_many`` side effects wired on the
    returned mock are observed by the production calls.
    """
    col: MagicMock = client.collections.use.return_value
    return col.data


class TestGetUuidsUsesDocId:
    """_get_uuids must return one id per input document, positionally aligned."""

    def test_doc_id_passes_through(self) -> None:
        v, _client = _make_vector()
        docs = [Document(page_content="x", metadata={"doc_id": "doc-aaa-1"})]

        uuids = v._get_uuids(docs)

        assert uuids == ["doc-aaa-1"]

    def test_missing_doc_id_falls_back_to_fresh_uuid4(self) -> None:
        """A document without ``doc_id`` still needs a slot in the
        returned list so the parallel ``objs`` list in ``add_texts``
        never goes out of alignment with the input documents.
        """
        v, _client = _make_vector()
        docs = [
            Document(page_content="x", metadata={"doc_id": "doc-aaa-1"}),
            Document(page_content="y", metadata={}),
            Document(page_content="z", metadata={"doc_id": "doc-ccc-3"}),
        ]

        uuids = v._get_uuids(docs)

        assert uuids[0] == "doc-aaa-1"
        assert uuids[2] == "doc-ccc-3"
        # The middle slot is filled, not dropped.
        assert len(uuids) == 3
        assert uuids[1] != ""
        # And the fallback is a valid UUID4.
        import uuid as _uuid

        parsed = _uuid.UUID(uuids[1])
        assert parsed.version == 4

    def test_all_doc_ids_present(self) -> None:
        v, _client = _make_vector()
        docs = [
            Document(page_content="x", metadata={"doc_id": "a"}),
            Document(page_content="y", metadata={"doc_id": "b"}),
            Document(page_content="z", metadata={"doc_id": "c"}),
        ]

        assert v._get_uuids(docs) == ["a", "b", "c"]


class TestDeleteByIdsBackwardCompatible:
    """#41714 backwards-compatibility: legacy UUID5 objects whose Weaviate
    UUID no longer matches ``index_node_id`` are reaped via the
    ``doc_id``-metadata filter."""

    def test_legacy_object_with_matching_doc_id_is_reaped(self) -> None:
        """A legacy object whose ``doc_id`` matches the supplied
        ``index_node_id`` must be reaped even though its Weaviate UUID
        no longer matches.
        """
        v, client = _make_vector()
        col = _collection(client)
        col.delete_by_id.side_effect = _FakeUnexpectedStatusCodeError(404)

        with patch.object(weaviate_vector_module, "UnexpectedStatusCodeError", _FakeUnexpectedStatusCodeError):
            v.delete_by_ids(["doc-aaa-1"])

        # Best-effort direct delete ran for each id.
        assert col.delete_by_id.call_count == 1
        # And the metadata catch-up filter ran with the same ids.
        col.delete_many.assert_called_once()
        kwargs = col.delete_many.call_args.kwargs
        where = kwargs["where"]
        # Filter.by_property("doc_id").contains_any(["doc-aaa-1"])
        assert "doc_id" in str(where)
        assert "doc-aaa-1" in str(where)

    def test_fresh_object_is_reaped_by_direct_delete(self) -> None:
        """A fresh object whose Weaviate UUID equals the supplied
        ``index_node_id`` is reaped by the direct delete, and the
        metadata-filter pass is a redundant no-op (no rows match).
        """
        v, client = _make_vector()
        col = _collection(client)

        v.delete_by_ids(["doc-aaa-1"])

        col.delete_by_id.assert_called_once_with("doc-aaa-1")
        # The metadata filter always runs, but it's a no-op when the row
        # is already gone (Weaviate's ``delete_many`` returns an empty
        # result set against the cleared UUID).
        col.delete_many.assert_called_once()
        where = col.delete_many.call_args.kwargs["where"]
        assert "doc_id" in str(where)
        assert "doc-aaa-1" in str(where)

    def test_non_404_error_propagates(self) -> None:
        """A non-404 (e.g. 500) error on direct delete must propagate,
        not be swallowed as if it were a 404.
        """
        import pytest

        v, client = _make_vector()
        col = _collection(client)
        col.delete_by_id.side_effect = _FakeUnexpectedStatusCodeError(500)

        with (
            patch.object(weaviate_vector_module, "UnexpectedStatusCodeError", _FakeUnexpectedStatusCodeError),
            pytest.raises(_FakeUnexpectedStatusCodeError),
        ):
            v.delete_by_ids(["doc-aaa-1"])

    def test_delete_many_404_is_swallowed(self) -> None:
        """The metadata-filter 404 (column doesn't exist) is also
        swallowed -- the schema may not have been migrated yet.
        """
        v, client = _make_vector()
        col = _collection(client)
        col.delete_by_id.side_effect = _FakeUnexpectedStatusCodeError(404)
        col.delete_many.side_effect = _FakeUnexpectedStatusCodeError(404)

        # Neither path raises.
        with patch.object(weaviate_vector_module, "UnexpectedStatusCodeError", _FakeUnexpectedStatusCodeError):
            v.delete_by_ids(["doc-aaa-1"])
