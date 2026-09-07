"""Regression tests for issue #41714.

The pre-fix code generated Weaviate object ids via
``uuid5(URL_NAMESPACE, page_content)`` (UUID v5 from content). The
cleanup path (``batch_clean_document_task`` → ``index_processor.clean``
→ ``vector.delete_by_ids``) passes the segment's ``index_node_id``
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
   too — backwards-compatible with the rows already in production.
"""

import pytest
from unittest.mock import MagicMock, patch

from core.rag.models.document import Document
from dify_vdb_weaviate import weaviate_vector as weaviate_vector_module
from dify_vdb_weaviate.weaviate_vector import WeaviateConfig, WeaviateVector


def _unexpected_response(status_code: int) -> "weaviate_vector_module.UnexpectedStatusCodeError":
    """Patch ``WeaviateVector.delete_by_ids`` to raise an ``UnexpectedStatusCodeError``.

    The constructor of the real exception class reaches into
    ``response.code()`` and ``response.details()`` (different members
    of the gRPC / HTTP / httpx response union types) and would need
    per-shape stubs. Use ``side_effect`` on the patch instead so the
    test does not have to instantiate the real class.
    """
    response = MagicMock()
    response.status_code = status_code
    response.details.return_value = ""
    err = weaviate_vector_module.UnexpectedStatusCodeError(f"status {status_code}", response)
    err.status_code = status_code  # ensure the property we read in production
    return err


def _make_raising_404_response():
    """Stand-in for the gRPC / HTTP / httpx response shape that
    ``UnexpectedStatusCodeError.__init__`` probes for ``code()`` and
    ``details()``. The constructor reads ``code().value[0]`` for the
    status and ``code().value[1]`` for the canonical name, plus
    ``details()`` for the body. Set all three.
    """
    from types import SimpleNamespace

    code = SimpleNamespace()
    # 404 lands in the first element of the value tuple, the canonical
    # name (``"Not Found"``) in the second.
    code.value = (404, "Not Found")
    response = MagicMock()
    response.code.return_value = code
    response.details.return_value = ""
    err = weaviate_vector_module.UnexpectedStatusCodeError("status 404", response)
    err.status_code = 404
    return err


def _make_vector(**overrides) -> WeaviateVector:
    config = WeaviateConfig(
        endpoint="http://localhost:8080",
        api_key="test-key",
        batch_size=100,
    )
    v = WeaviateVector.__new__(WeaviateVector)
    v._config = config
    v._collection_name = "Test_Collection"
    v._attributes = ["doc_id", "dataset_id"]
    v._client = MagicMock()
    for k, val in overrides.items():
        setattr(v, f"_{k}", val)
    return v


class TestGetUuidsUsesDocId:
    """_get_uuids must return one id per input document, positionally aligned."""

    def test_doc_id_passes_through(self):
        v = _make_vector()
        docs = [Document(page_content="x", metadata={"doc_id": "doc-aaa-1"})]

        uuids = v._get_uuids(docs)

        assert uuids == ["doc-aaa-1"]

    def test_missing_doc_id_falls_back_to_fresh_uuid4(self):
        """A document without ``doc_id`` still needs a slot in the
        returned list so the parallel ``objs`` list in ``add_texts``
        never goes out of alignment with the input documents.
        """
        v = _make_vector()
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

    def test_all_doc_ids_present(self):
        v = _make_vector()
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

    def test_legacy_object_with_matching_doc_id_is_reaped(self):
        """A legacy object whose ``doc_id`` matches the supplied
        ``index_node_id`` must be reaped even though its Weaviate UUID
        no longer matches.
        """
        v = _make_vector()
        col = v._client.collections.use.return_value
        # The production code only reads ``.status_code`` from the
        # raised exception; use a plain Mock with that attribute instead
        # of instantiating the real ``UnexpectedStatusCodeError`` (which
        # probes gRPC / httpx response members and breaks the test).
        not_found = MagicMock()
        not_found.status_code = 404
        col.data.delete_by_id.side_effect = not_found

        v.delete_by_ids(["doc-aaa-1"])

        # Best-effort direct delete ran for each id.
        assert col.data.delete_by_id.call_count == 1
        # And the metadata catch-up filter ran with the same ids.
        col.data.delete_many.assert_called_once()
        kwargs = col.data.delete_many.call_args.kwargs
        where = kwargs["where"]
        # Filter.by_property("doc_id").contains_any(["doc-aaa-1"])
        assert "doc_id" in str(where)
        assert "doc-aaa-1" in str(where)

    def test_fresh_object_is_reaped_by_direct_delete(self):
        """A fresh object whose Weaviate UUID equals the supplied
        ``index_node_id`` is reaped by the direct delete, and the
        metadata-filter pass is a redundant no-op (no rows match).
        """
        v = _make_vector()
        col = v._client.collections.use.return_value

        v.delete_by_ids(["doc-aaa-1"])

        col.data.delete_by_id.assert_called_once_with("doc-aaa-1")
        # The metadata filter always runs, but it's a no-op when the row
        # is already gone (Weaviate's ``delete_many`` returns an empty
        # result set against the cleared UUID).
        col.data.delete_many.assert_called_once()
        where = col.data.delete_many.call_args.kwargs["where"]
        assert "doc_id" in str(where)
        assert "doc-aaa-1" in str(where)

    def test_non_404_error_propagates(self):
        """A non-404 (e.g. 500) error on direct delete must propagate,
        not be swallowed as if it were a 404.
        """

        class _ServerError(Exception):
            status_code = 500

        v = _make_vector()
        col = v._client.collections.use.return_value
        col.data.delete_by_id.side_effect = _ServerError()

        with pytest.raises(_ServerError):
            v.delete_by_ids(["doc-aaa-1"])

    def test_delete_many_404_is_swallowed(self):
        """The metadata-filter 404 (column doesn't exist) is also
        swallowed — the schema may not have been migrated yet.
        """
        v = _make_vector()
        col = v._client.collections.use.return_value
        not_found_a = MagicMock()
        not_found_a.status_code = 404
        not_found_b = MagicMock()
        not_found_b.status_code = 404
        col.data.delete_by_id.side_effect = not_found_a
        col.data.delete_many.side_effect = not_found_b

        # Neither path raises.
        v.delete_by_ids(["doc-aaa-1"])
