"""Unit tests for SegmentService behaviors in dataset_service."""

from .dataset_service_test_helpers import (
    Account,
    ChildChunk,
    ChildChunkDeleteIndexError,
    ChildChunkIndexingError,
    ChildChunkUpdateArgs,
    DocumentSegment,
    IndexStructureType,
    MagicMock,
    ModelType,
    SegmentService,
    SegmentUpdateArgs,
    SimpleNamespace,
    _make_child_chunk,
    _make_dataset,
    _make_document,
    _make_lock_context,
    _make_segment,
    create_autospec,
    patch,
    pytest,
)


class TestSegmentServiceChildChunks:
    """Unit tests for child-chunk CRUD helpers."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_create_child_chunk_assigns_next_position_and_commits(self, account_context):
        dataset = SimpleNamespace(id="dataset-1")
        document = _make_document()
        segment = _make_segment()

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.uuid.uuid4", return_value="node-1"),
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-1"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_redis.lock.return_value = _make_lock_context()
            mock_db.session.scalar.return_value = 2

            child_chunk = SegmentService.create_child_chunk("child content", segment, document, dataset)

        assert isinstance(child_chunk, ChildChunk)
        assert child_chunk.position == 3
        assert child_chunk.index_node_id == "node-1"
        assert child_chunk.index_node_hash == "hash-1"
        assert child_chunk.word_count == len("child content")
        mock_db.session.add.assert_called_once_with(child_chunk)
        vector_service.create_child_chunk_vector.assert_called_once_with(child_chunk, dataset)
        mock_db.session.commit.assert_called_once()

    def test_create_child_chunk_rolls_back_and_raises_on_vector_failure(self, account_context):
        dataset = SimpleNamespace(id="dataset-1")
        document = _make_document()
        segment = _make_segment()

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.uuid.uuid4", return_value="node-1"),
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-1"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_redis.lock.return_value = _make_lock_context()
            mock_db.session.scalar.return_value = None
            vector_service.create_child_chunk_vector.side_effect = RuntimeError("vector failed")

            with pytest.raises(ChildChunkIndexingError, match="vector failed"):
                SegmentService.create_child_chunk("child content", segment, document, dataset)

        mock_db.session.rollback.assert_called_once()
        mock_db.session.commit.assert_not_called()

    def test_update_child_chunks_updates_deletes_and_creates_records(self, account_context):
        dataset = SimpleNamespace(id="dataset-1")
        document = _make_document()
        segment = _make_segment()
        existing_a = ChildChunk(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="doc-1",
            segment_id="segment-1",
            position=1,
            content="old content",
            word_count=11,
            created_by="user-1",
        )
        existing_b = ChildChunk(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="doc-1",
            segment_id="segment-1",
            position=2,
            content="remove me",
            word_count=9,
            created_by="user-1",
        )
        existing_a.id = "child-a"
        existing_b.id = "child-b"
        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.uuid.uuid4", return_value="node-new"),
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-new"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_db.session.scalars.return_value.all.return_value = [existing_a, existing_b]

            result = SegmentService.update_child_chunks(
                [
                    ChildChunkUpdateArgs(id="child-a", content="updated content"),
                    ChildChunkUpdateArgs(content="brand new"),
                ],
                segment,
                document,
                dataset,
            )

        assert [chunk.position for chunk in result] == [1, 3]
        assert existing_a.content == "updated content"
        assert existing_a.updated_by == account_context.id
        assert existing_a.updated_at == "now"
        mock_db.session.bulk_save_objects.assert_called_once_with([existing_a])
        mock_db.session.delete.assert_called_once_with(existing_b)
        new_chunk = result[1]
        assert isinstance(new_chunk, ChildChunk)
        assert new_chunk.position == 3
        assert new_chunk.index_node_id == "node-new"
        vector_service.update_child_chunk_vector.assert_called_once_with(
            [new_chunk], [existing_a], [existing_b], dataset
        )
        mock_db.session.commit.assert_called_once()

    def test_update_child_chunks_rolls_back_on_vector_failure(self, account_context):
        dataset = SimpleNamespace(id="dataset-1")
        document = _make_document()
        segment = _make_segment()
        existing_chunk = _make_child_chunk()

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_db.session.scalars.return_value.all.return_value = [existing_chunk]
            vector_service.update_child_chunk_vector.side_effect = RuntimeError("vector failed")

            with pytest.raises(ChildChunkIndexingError, match="vector failed"):
                SegmentService.update_child_chunks(
                    [ChildChunkUpdateArgs(id="child-a", content="updated content")],
                    segment,
                    document,
                    dataset,
                )

        mock_db.session.rollback.assert_called_once()

    def test_update_child_chunk_updates_vector_and_commits(self, account_context):
        dataset = SimpleNamespace(id="dataset-1")
        child_chunk = _make_child_chunk()

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(id="user-1")),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            result = SegmentService.update_child_chunk(
                "new content", child_chunk, _make_segment(), _make_document(), dataset
            )

        assert result is child_chunk
        assert child_chunk.content == "new content"
        assert child_chunk.word_count == len("new content")
        assert child_chunk.updated_by == "user-1"
        assert child_chunk.updated_at == "now"
        mock_db.session.add.assert_called_once_with(child_chunk)
        vector_service.update_child_chunk_vector.assert_called_once_with([], [child_chunk], [], dataset)
        mock_db.session.commit.assert_called_once()

    def test_delete_child_chunk_raises_delete_index_error_on_vector_failure(self):
        dataset = SimpleNamespace(id="dataset-1")
        child_chunk = _make_child_chunk()

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            vector_service.delete_child_chunk_vector.side_effect = RuntimeError("delete failed")

            with pytest.raises(ChildChunkDeleteIndexError, match="delete failed"):
                SegmentService.delete_child_chunk(child_chunk, dataset)

        mock_db.session.delete.assert_called_once_with(child_chunk)
        mock_db.session.rollback.assert_called_once()


class TestSegmentServiceQueries:
    """Unit tests for child-chunk and segment query helpers."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_get_child_chunks_applies_keyword_filter_and_paginate(self, account_context):
        paginated = SimpleNamespace(items=["chunk"], total=1)

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.helper.escape_like_pattern", return_value="escaped") as escape_like,
        ):
            mock_db.paginate.return_value = paginated

            result = SegmentService.get_child_chunks(
                segment_id="segment-1",
                document_id="doc-1",
                dataset_id="dataset-1",
                page=2,
                limit=10,
                keyword="needle",
            )

        assert result is paginated
        escape_like.assert_called_once_with("needle")
        mock_db.paginate.assert_called_once()

    def test_get_child_chunk_by_id_returns_only_child_chunk_instances(self):
        child_chunk = _make_child_chunk()

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalar.return_value = child_chunk
            result = SegmentService.get_child_chunk_by_id("child-a", "tenant-1")

        assert result is child_chunk

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalar.return_value = SimpleNamespace()
            result = SegmentService.get_child_chunk_by_id("child-a", "tenant-1")

        assert result is None

    def test_get_segments_uses_status_and_keyword_filters(self):
        paginated = SimpleNamespace(items=["segment"], total=1)

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.helper.escape_like_pattern", return_value="escaped") as escape_like,
        ):
            mock_db.paginate.return_value = paginated

            items, total = SegmentService.get_segments(
                document_id="doc-1",
                tenant_id="tenant-1",
                status_list=["completed"],
                keyword="needle",
                page=1,
                limit=20,
            )

        assert items == ["segment"]
        assert total == 1
        escape_like.assert_called_once_with("needle")
        mock_db.paginate.assert_called_once()

    def test_get_segment_by_id_returns_only_document_segment_instances(self):
        segment = DocumentSegment(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="doc-1",
            position=1,
            content="segment",
            word_count=7,
            tokens=2,
            created_by="user-1",
        )
        segment.id = "segment-1"
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalar.return_value = segment
            result = SegmentService.get_segment_by_id("segment-1", "tenant-1")

        assert result is segment

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalar.return_value = SimpleNamespace()
            result = SegmentService.get_segment_by_id("segment-1", "tenant-1")

        assert result is None

    def test_get_segments_by_document_and_dataset_returns_scalars_result(self):
        segment = DocumentSegment(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="doc-1",
            position=1,
            content="segment",
            word_count=7,
            tokens=2,
            created_by="user-1",
        )

        segment.id = "segment-1"
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [segment]

            result = SegmentService.get_segments_by_document_and_dataset(
                document_id="doc-1",
                dataset_id="dataset-1",
                status="completed",
                enabled=True,
            )

        assert result == [segment]
        mock_db.session.scalars.assert_called_once()


class TestSegmentServiceValidation:
    """Unit tests for segment-create argument validation."""

    def test_segment_create_args_validate_requires_answer_for_qa_model(self):
        document = _make_document(doc_form=IndexStructureType.QA_INDEX)

        with pytest.raises(ValueError, match="Answer is required"):
            SegmentService.segment_create_args_validate({"content": "question"}, document)

    def test_segment_create_args_validate_requires_non_empty_content(self):
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX)

        with pytest.raises(ValueError, match="Content is empty"):
            SegmentService.segment_create_args_validate({"content": "   "}, document)

    def test_segment_create_args_validate_enforces_attachment_limit(self):
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX)
        args = {"content": "hello", "attachment_ids": ["a-1", "a-2"]}

        with patch("services.dataset_service.dify_config.SINGLE_CHUNK_ATTACHMENT_LIMIT", 1):
            with pytest.raises(ValueError, match="Exceeded maximum attachment limit of 1"):
                SegmentService.segment_create_args_validate(args, document)

    def test_segment_create_args_validate_requires_attachment_ids_list(self):
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX)

        with pytest.raises(ValueError, match="Attachment IDs is invalid"):
            SegmentService.segment_create_args_validate({"content": "hello", "attachment_ids": "bad-type"}, document)


class TestSegmentServiceMutations:
    """Unit tests for segment create, update, delete, and bulk status flows."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_create_segment_creates_bindings_and_marks_segment_error_on_vector_failure(self, account_context):
        dataset = _make_dataset(indexing_technique="economy")
        document = _make_document(
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            doc_form=IndexStructureType.QA_INDEX,
            word_count=0,
        )
        refreshed_segment = SimpleNamespace(id="segment-1")
        args = {
            "content": "question",
            "answer": "answer",
            "keywords": ["kw-1"],
            "attachment_ids": ["att-1", "att-2"],
        }

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-1"),
            patch("services.dataset_service.uuid.uuid4", return_value="node-1"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
        ):
            mock_redis.lock.return_value = _make_lock_context()

            mock_db.session.scalar.return_value = 2
            mock_db.session.get.return_value = refreshed_segment

            def add_side_effect(obj):
                if obj.__class__.__name__ == "DocumentSegment" and getattr(obj, "id", None) is None:
                    obj.id = "segment-1"

            mock_db.session.add.side_effect = add_side_effect
            vector_service.create_segments_vector.side_effect = RuntimeError("vector failed")

            result = SegmentService.create_segment(args=args, document=document, dataset=dataset)

        created_segment = vector_service.create_segments_vector.call_args.args[1][0]
        attachment_bindings = [
            call.args[0]
            for call in mock_db.session.add.call_args_list
            if call.args and call.args[0].__class__.__name__ == "SegmentAttachmentBinding"
        ]

        assert result is refreshed_segment
        assert created_segment.position == 3
        assert created_segment.answer == "answer"
        assert created_segment.word_count == len("question") + len("answer")
        assert created_segment.status == "error"
        assert created_segment.enabled is False
        assert created_segment.error == "vector failed"
        assert document.word_count == len("question") + len("answer")
        assert len(attachment_bindings) == 2
        assert {binding.attachment_id for binding in attachment_bindings} == {"att-1", "att-2"}
        assert mock_db.session.commit.call_count == 3

    def test_multi_create_segment_high_quality_marks_segments_error_when_vector_creation_fails(self, account_context):
        dataset = _make_dataset(indexing_technique="high_quality")
        document = _make_document(
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            doc_form=IndexStructureType.QA_INDEX,
            word_count=5,
        )
        segments = [
            {"content": "question-1", "answer": "answer-1", "keywords": ["k1"]},
            {"content": "question-2", "answer": "answer-2"},
        ]
        embedding_model = MagicMock()
        embedding_model.get_text_embedding_num_tokens.side_effect = [[11], [13]]

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", side_effect=["hash-1", "hash-2"]),
            patch("services.dataset_service.uuid.uuid4", side_effect=["node-1", "node-2"]),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
            mock_db.session.scalar.return_value = 1
            vector_service.create_segments_vector.side_effect = RuntimeError("vector failed")

            result = SegmentService.multi_create_segment(segments, document, dataset)
            assert result

        assert len(result) == 2
        assert [segment.position for segment in result] == [2, 3]
        assert [segment.tokens for segment in result] == [11, 13]
        assert all(segment.status == "error" for segment in result)
        assert all(segment.enabled is False for segment in result)
        assert all(segment.error == "vector failed" for segment in result)
        assert document.word_count == 5 + sum(len(item["content"]) + len(item["answer"]) for item in segments)
        vector_service.create_segments_vector.assert_called_once_with(
            [["k1"], None], result, dataset, document.doc_form
        )
        mock_db.session.commit.assert_called_once()

    def test_update_segment_disables_enabled_segment_and_dispatches_index_cleanup(self, account_context):
        segment = _make_segment(enabled=True)
        document = _make_document()
        dataset = _make_dataset()
        args = SegmentUpdateArgs(enabled=False)

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.disable_segment_from_index_task") as disable_task,
        ):
            mock_redis.get.return_value = None

            result = SegmentService.update_segment(args, segment, document, dataset)

        assert result is segment
        assert segment.enabled is False
        assert segment.disabled_at == "now"
        assert segment.disabled_by == account_context.id
        mock_db.session.add.assert_called_once_with(segment)
        mock_db.session.commit.assert_called_once()
        mock_redis.setex.assert_called_once_with(f"segment_{segment.id}_indexing", 600, 1)
        disable_task.delay.assert_called_once_with(segment.id)

    def test_update_segment_rejects_updates_for_disabled_segment(self, account_context):
        segment = _make_segment(enabled=False)
        document = _make_document()
        dataset = _make_dataset()

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = None

            with pytest.raises(ValueError, match="Can't update disabled segment"):
                SegmentService.update_segment(SegmentUpdateArgs(content="new content"), segment, document, dataset)

    def test_update_segment_rejects_when_indexing_cache_exists(self, account_context):
        segment = _make_segment(enabled=True)
        document = _make_document()
        dataset = _make_dataset()

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = "1"

            with pytest.raises(ValueError, match="Segment is indexing"):
                SegmentService.update_segment(SegmentUpdateArgs(content="new content"), segment, document, dataset)

    def test_update_segment_updates_keywords_for_same_content_segment(self, account_context):
        segment = _make_segment(content="same content", keywords=["old"])
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX, word_count=20)
        dataset = _make_dataset()
        refreshed_segment = SimpleNamespace(id=segment.id)
        args = SegmentUpdateArgs(content="same content", keywords=["new"])

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_redis.get.return_value = None
            mock_db.session.get.return_value = refreshed_segment

            result = SegmentService.update_segment(args, segment, document, dataset)

        assert result is refreshed_segment
        assert segment.keywords == ["new"]
        vector_service.update_segment_vector.assert_called_once_with(["new"], segment, dataset)
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_regenerates_child_chunks_and_updates_manual_summary(self, account_context):
        segment = _make_segment(content="same content", word_count=len("same content"))
        document = _make_document(
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
            word_count=20,
        )
        dataset = _make_dataset(indexing_technique="high_quality")
        refreshed_segment = SimpleNamespace(id=segment.id)
        processing_rule = SimpleNamespace(id=document.dataset_process_rule_id)
        existing_summary = SimpleNamespace(summary_content="old summary")
        embedding_model_instance = object()
        args = SegmentUpdateArgs(
            content="same content",
            regenerate_child_chunks=True,
            summary="new summary",
        )

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.summary_index_service.SummaryIndexService.update_summary_for_segment") as update_summary,
        ):
            mock_redis.get.return_value = None
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model_instance

            # get calls: processing_rule, then refreshed_segment
            mock_db.session.get.side_effect = [processing_rule, refreshed_segment]
            # scalar call: existing_summary
            mock_db.session.scalar.return_value = existing_summary

            result = SegmentService.update_segment(args, segment, document, dataset)

        assert result is refreshed_segment
        vector_service.generate_child_chunks.assert_called_once_with(
            segment,
            document,
            dataset,
            embedding_model_instance,
            processing_rule,
            True,
        )
        update_summary.assert_called_once_with(segment, dataset, "new summary")
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_auto_regenerates_summary_after_content_change(self, account_context):
        segment = _make_segment(content="old", word_count=3)
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX, word_count=10)
        dataset = _make_dataset(indexing_technique="high_quality")
        dataset.summary_index_setting = {"enable": True}
        refreshed_segment = SimpleNamespace(id=segment.id)
        existing_summary = SimpleNamespace(summary_content="old summary")
        embedding_model = MagicMock()
        embedding_model.get_text_embedding_num_tokens.return_value = [9]
        args = SegmentUpdateArgs(content="new content", keywords=["kw-1"])

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-1"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch(
                "services.summary_index_service.SummaryIndexService.generate_and_vectorize_summary"
            ) as generate_summary,
        ):
            mock_redis.get.return_value = None
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model

            mock_db.session.scalar.return_value = existing_summary
            mock_db.session.get.return_value = refreshed_segment

            result = SegmentService.update_segment(args, segment, document, dataset)

        assert result is refreshed_segment
        assert segment.content == "new content"
        assert segment.index_node_hash == "hash-1"
        assert segment.tokens == 9
        assert document.word_count == 18
        vector_service.update_segment_vector.assert_called_once_with(["kw-1"], segment, dataset)
        generate_summary.assert_called_once_with(segment, dataset, {"enable": True})
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_regenerates_summary_when_manual_summary_is_unchanged(self, account_context):
        segment = _make_segment(content="old", word_count=3)
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX, word_count=10)
        dataset = _make_dataset(indexing_technique="high_quality")
        dataset.summary_index_setting = {"enable": True}
        refreshed_segment = SimpleNamespace(id=segment.id)
        existing_summary = SimpleNamespace(summary_content="same summary")
        embedding_model = MagicMock()
        embedding_model.get_text_embedding_num_tokens.return_value = [7]
        args = SegmentUpdateArgs(content="new text", summary="same summary")

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-2"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch(
                "services.summary_index_service.SummaryIndexService.generate_and_vectorize_summary"
            ) as generate_summary,
            patch("services.summary_index_service.SummaryIndexService.update_summary_for_segment") as update_summary,
        ):
            mock_redis.get.return_value = None
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model

            mock_db.session.scalar.return_value = existing_summary
            mock_db.session.get.return_value = refreshed_segment

            result = SegmentService.update_segment(args, segment, document, dataset)

        assert result is refreshed_segment
        generate_summary.assert_called_once_with(segment, dataset, {"enable": True})
        update_summary.assert_not_called()
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_delete_segment_removes_index_and_updates_document_word_count(self):
        segment = _make_segment(word_count=4, index_node_id="parent-node")
        document = _make_document(word_count=10)
        dataset = _make_dataset()

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.delete_segment_from_index_task") as delete_task,
        ):
            mock_redis.get.return_value = None
            mock_db.session.scalars.return_value.all.return_value = ["child-1", "child-2"]

            SegmentService.delete_segment(segment, document, dataset)

        assert document.word_count == 6
        mock_redis.setex.assert_called_once_with(f"segment_{segment.id}_delete_indexing", 600, 1)
        delete_task.delay.assert_called_once_with(
            ["parent-node"],
            dataset.id,
            document.id,
            [segment.id],
            ["child-1", "child-2"],
        )
        mock_db.session.delete.assert_called_once_with(segment)
        mock_db.session.add.assert_called_once_with(document)
        mock_db.session.commit.assert_called_once()

    def test_delete_segment_rejects_when_delete_is_already_in_progress(self):
        segment = _make_segment()
        document = _make_document()
        dataset = _make_dataset()

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = "1"

            with pytest.raises(ValueError, match="Segment is deleting"):
                SegmentService.delete_segment(segment, document, dataset)

    def test_delete_segments_removes_records_and_clamps_document_word_count(self):
        dataset = _make_dataset()
        document = _make_document(word_count=3)
        current_user = SimpleNamespace(current_tenant_id="tenant-1")

        with (
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.delete_segment_from_index_task") as delete_task,
        ):
            # execute().all() for segments_info (multi-column)
            execute_result = MagicMock()
            execute_result.all.return_value = [
                ("node-1", "segment-1", 2),
                ("node-2", "segment-2", 5),
            ]
            mock_db.session.execute.return_value = execute_result
            # scalars() for child_node_ids
            mock_db.session.scalars.return_value.all.return_value = ["child-1"]

            SegmentService.delete_segments(["segment-1", "segment-2"], document, dataset)

        assert document.word_count == 0
        mock_db.session.add.assert_called_once_with(document)
        delete_task.delay.assert_called_once_with(
            ["node-1", "node-2"],
            dataset.id,
            document.id,
            ["segment-1", "segment-2"],
            ["child-1"],
        )
        mock_db.session.commit.assert_called_once()

    def test_update_segments_status_enables_only_segments_without_indexing_cache(self):
        dataset = _make_dataset()
        document = _make_document()
        segment_a = _make_segment(segment_id="segment-a", enabled=False)
        segment_b = _make_segment(segment_id="segment-b", enabled=False)
        current_user = SimpleNamespace(id="user-1", current_tenant_id="tenant-1")

        with (
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.enable_segments_to_index_task") as enable_task,
        ):
            mock_db.session.scalars.return_value.all.return_value = [segment_a, segment_b]
            mock_redis.get.side_effect = [None, "1"]

            SegmentService.update_segments_status(["segment-a", "segment-b"], "enable", dataset, document)

        assert segment_a.enabled is True
        assert segment_a.disabled_at is None
        assert segment_a.disabled_by is None
        assert segment_b.enabled is False
        mock_db.session.add.assert_called_once_with(segment_a)
        mock_db.session.commit.assert_called_once()
        enable_task.delay.assert_called_once_with(["segment-a"], dataset.id, document.id)

    def test_update_segments_status_disables_only_segments_without_indexing_cache(self):
        dataset = _make_dataset()
        document = _make_document()
        segment_a = _make_segment(segment_id="segment-a", enabled=True)
        segment_b = _make_segment(segment_id="segment-b", enabled=True)
        current_user = SimpleNamespace(id="user-1", current_tenant_id="tenant-1")

        with (
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.disable_segments_from_index_task") as disable_task,
        ):
            mock_db.session.scalars.return_value.all.return_value = [segment_a, segment_b]
            mock_redis.get.side_effect = [None, "1"]

            SegmentService.update_segments_status(["segment-a", "segment-b"], "disable", dataset, document)

        assert segment_a.enabled is False
        assert segment_a.disabled_at == "now"
        assert segment_a.disabled_by == current_user.id
        assert segment_b.enabled is True
        mock_db.session.add.assert_called_once_with(segment_a)
        mock_db.session.commit.assert_called_once()
        disable_task.delay.assert_called_once_with(["segment-a"], dataset.id, document.id)


class TestSegmentServiceChildChunkTailHelpers:
    """Unit tests for the remaining child-chunk helper branches."""

    def test_update_child_chunk_rolls_back_on_vector_failure(self):
        dataset = SimpleNamespace(id="dataset-1")
        child_chunk = _make_child_chunk()

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(id="user-1")),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            vector_service.update_child_chunk_vector.side_effect = RuntimeError("vector failed")

            with pytest.raises(ChildChunkIndexingError, match="vector failed"):
                SegmentService.update_child_chunk(
                    "new content", child_chunk, SimpleNamespace(), SimpleNamespace(), dataset
                )

        mock_db.session.rollback.assert_called_once()
        mock_db.session.commit.assert_not_called()

    def test_delete_child_chunk_commits_after_successful_vector_delete(self):
        dataset = SimpleNamespace(id="dataset-1")
        child_chunk = _make_child_chunk()

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            SegmentService.delete_child_chunk(child_chunk, dataset)

        mock_db.session.delete.assert_called_once_with(child_chunk)
        vector_service.delete_child_chunk_vector.assert_called_once_with(child_chunk, dataset)
        mock_db.session.commit.assert_called_once()


class TestSegmentServiceAdditionalRegenerationBranches:
    """Additional unit tests for segment update and regeneration edge cases."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_update_segment_same_content_updates_answer_and_document_word_count_for_qa_segments(self, account_context):
        segment = _make_segment(content="question", word_count=8)
        document = _make_document(doc_form=IndexStructureType.QA_INDEX, word_count=20)
        dataset = _make_dataset()
        refreshed_segment = SimpleNamespace(id=segment.id)

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_redis.get.return_value = None
            mock_db.session.get.return_value = refreshed_segment

            result = SegmentService.update_segment(
                SegmentUpdateArgs(content="question", answer="new answer"),
                segment,
                document,
                dataset,
            )

        assert result is refreshed_segment
        assert segment.answer == "new answer"
        assert segment.word_count == len("question") + len("new answer")
        assert document.word_count == 20 + (len("question") + len("new answer") - 8)
        vector_service.update_segment_vector.assert_not_called()
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_content_change_uses_answer_when_counting_tokens_for_qa_segments(self, account_context):
        segment = _make_segment(content="old", word_count=3)
        document = _make_document(doc_form=IndexStructureType.QA_INDEX, word_count=10)
        dataset = _make_dataset(indexing_technique="high_quality")
        refreshed_segment = SimpleNamespace(id=segment.id)
        embedding_model = MagicMock()
        embedding_model.get_text_embedding_num_tokens.return_value = [21]

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-qa"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
        ):
            mock_redis.get.return_value = None
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
            mock_db.session.scalar.return_value = None
            mock_db.session.get.return_value = refreshed_segment

            result = SegmentService.update_segment(
                SegmentUpdateArgs(content="new question", answer="new answer", keywords=["kw-1"]),
                segment,
                document,
                dataset,
            )

        assert result is refreshed_segment
        embedding_model.get_text_embedding_num_tokens.assert_called_once_with(texts=["new questionnew answer"])
        assert segment.answer == "new answer"
        assert segment.tokens == 21
        assert segment.word_count == len("new question") + len("new answer")
        vector_service.update_segment_vector.assert_called_once_with(["kw-1"], segment, dataset)
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_content_change_parent_child_uses_default_embedding_and_ignores_summary_failures(
        self, account_context
    ):
        segment = _make_segment(content="old", word_count=3)
        document = _make_document(
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
            word_count=10,
        )
        dataset = _make_dataset(indexing_technique="high_quality")
        dataset.embedding_model_provider = None
        refreshed_segment = SimpleNamespace(id=segment.id)
        processing_rule = SimpleNamespace(id=document.dataset_process_rule_id)
        existing_summary = SimpleNamespace(summary_content="old summary")
        embedding_model_instance = object()

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-parent"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.summary_index_service.SummaryIndexService.update_summary_for_segment") as update_summary,
        ):
            mock_redis.get.return_value = None
            model_manager_cls.for_tenant.return_value.get_default_model_instance.return_value = embedding_model_instance
            update_summary.side_effect = RuntimeError("summary failed")

            # get calls: processing_rule, then refreshed_segment
            mock_db.session.get.side_effect = [processing_rule, refreshed_segment]
            # scalar call: existing_summary
            mock_db.session.scalar.return_value = existing_summary

            result = SegmentService.update_segment(
                SegmentUpdateArgs(content="new parent content", regenerate_child_chunks=True, summary="new summary"),
                segment,
                document,
                dataset,
            )

        assert result is refreshed_segment
        model_manager_cls.for_tenant.return_value.get_default_model_instance.assert_called_once_with(
            tenant_id="tenant-1",
            model_type=ModelType.TEXT_EMBEDDING,
        )
        vector_service.generate_child_chunks.assert_called_once_with(
            segment,
            document,
            dataset,
            embedding_model_instance,
            processing_rule,
            True,
        )
        update_summary.assert_called_once_with(segment, dataset, "new summary")
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_same_content_parent_child_marks_segment_error_for_non_high_quality_dataset(
        self, account_context
    ):
        segment = _make_segment(content="same content", word_count=len("same content"))
        document = _make_document(
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
            word_count=20,
        )
        dataset = _make_dataset(indexing_technique="economy")
        refreshed_segment = SimpleNamespace(id=segment.id)

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_redis.get.return_value = None
            mock_db.session.get.return_value = refreshed_segment

            result = SegmentService.update_segment(
                SegmentUpdateArgs(content="same content", regenerate_child_chunks=True),
                segment,
                document,
                dataset,
            )

        assert result is refreshed_segment
        assert segment.enabled is False
        assert segment.disabled_at == "now"
        assert segment.status == "error"
        assert segment.error == "The knowledge base index technique is not high quality!"
        vector_service.update_multimodel_vector.assert_not_called()
