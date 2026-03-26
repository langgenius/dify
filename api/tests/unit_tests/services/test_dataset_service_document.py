"""Unit tests for DocumentService behaviors in dataset_service."""

from .dataset_service_test_helpers import (
    Account,
    BuiltInField,
    CloudPlan,
    DatasetProcessRule,
    DatasetService,
    DatasetServiceUnitDataFactory,
    DataSource,
    DocumentIndexingError,
    DocumentService,
    FileInfo,
    FileNotExistsError,
    Forbidden,
    IndexStructureType,
    InfoList,
    KnowledgeConfig,
    MagicMock,
    NoPermissionError,
    NotFound,
    NotionIcon,
    NotionInfo,
    NotionPage,
    PreProcessingRule,
    ProcessRule,
    RerankingModel,
    RetrievalMethod,
    RetrievalModel,
    Rule,
    Segmentation,
    SimpleNamespace,
    WebsiteInfo,
    _make_dataset,
    _make_document,
    _make_features,
    _make_lock_context,
    _make_session_context,
    _make_upload_knowledge_config,
    create_autospec,
    json,
    patch,
    pytest,
)


class TestDocumentServiceDisplayStatus:
    """Unit tests for DocumentService display-status helpers."""

    @pytest.mark.parametrize(
        ("raw_status", "expected"),
        [
            ("enabled", "available"),
            ("AVAILABLE", "available"),
            ("paused", "paused"),
            ("unknown", None),
            (None, None),
        ],
    )
    def test_normalize_display_status(self, raw_status, expected):
        assert DocumentService.normalize_display_status(raw_status) == expected

    def test_build_display_status_filters_returns_empty_tuple_for_unknown_status(self):
        assert DocumentService.build_display_status_filters("missing") == ()

    def test_apply_display_status_filter_returns_original_query_for_unknown_status(self):
        query = MagicMock()

        result = DocumentService.apply_display_status_filter(query, "missing")

        assert result is query
        query.where.assert_not_called()

    def test_apply_display_status_filter_applies_where_for_known_status(self):
        query = MagicMock()
        filtered_query = MagicMock()
        query.where.return_value = filtered_query

        result = DocumentService.apply_display_status_filter(query, "enabled")

        assert result is filtered_query
        query.where.assert_called_once()


class TestDocumentServiceQueryAndDownloadHelpers:
    """Unit tests for DocumentService query helpers and download flows."""

    def test_get_document_returns_none_when_document_id_is_missing(self):
        with patch("services.dataset_service.db") as mock_db:
            result = DocumentService.get_document("dataset-1", None)

        assert result is None
        mock_db.session.query.assert_not_called()

    def test_get_document_queries_by_dataset_and_document_id(self):
        document = DatasetServiceUnitDataFactory.create_document_mock()

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.first.return_value = document

            result = DocumentService.get_document("dataset-1", "doc-1")

        assert result is document

    def test_get_documents_by_ids_returns_empty_for_empty_input(self):
        with patch("services.dataset_service.db") as mock_db:
            result = DocumentService.get_documents_by_ids("dataset-1", [])

        assert result == []
        mock_db.session.scalars.assert_not_called()

    def test_get_documents_by_ids_uses_single_batch_query(self):
        document = DatasetServiceUnitDataFactory.create_document_mock()

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [document]

            result = DocumentService.get_documents_by_ids("dataset-1", ["doc-1"])

        assert result == [document]
        mock_db.session.scalars.assert_called_once()

    def test_update_documents_need_summary_returns_zero_for_empty_input(self):
        with patch("services.dataset_service.session_factory") as session_factory_mock:
            result = DocumentService.update_documents_need_summary("dataset-1", [])

        assert result == 0
        session_factory_mock.create_session.assert_not_called()

    def test_update_documents_need_summary_updates_matching_documents_and_commits(self):
        session = MagicMock()
        session.query.return_value.filter.return_value.update.return_value = 2

        with patch("services.dataset_service.session_factory") as session_factory_mock:
            session_factory_mock.create_session.return_value = _make_session_context(session)

            result = DocumentService.update_documents_need_summary(
                "dataset-1",
                ["doc-1", "doc-2"],
                need_summary=False,
            )

        assert result == 2
        session.commit.assert_called_once()

    def test_get_document_download_url_uses_upload_file_lookup_and_signed_url_helper(self):
        upload_file = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-1")
        document = DatasetServiceUnitDataFactory.create_document_mock()

        with (
            patch.object(DocumentService, "_get_upload_file_for_upload_file_document", return_value=upload_file),
            patch("services.dataset_service.file_helpers.get_signed_file_url", return_value="signed-url") as get_url,
        ):
            result = DocumentService.get_document_download_url(document)

        assert result == "signed-url"
        get_url.assert_called_once_with(upload_file_id="file-1", as_attachment=True)

    def test_get_upload_file_id_for_upload_file_document_rejects_invalid_source_type(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(data_source_type="not-upload-file")

        with pytest.raises(NotFound, match="invalid source"):
            DocumentService._get_upload_file_id_for_upload_file_document(
                document,
                invalid_source_message="invalid source",
                missing_file_message="missing file",
            )

    def test_get_upload_file_id_for_upload_file_document_rejects_missing_upload_file_id(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(data_source_info_dict={})

        with pytest.raises(NotFound, match="missing file"):
            DocumentService._get_upload_file_id_for_upload_file_document(
                document,
                invalid_source_message="invalid source",
                missing_file_message="missing file",
            )

    def test_get_upload_file_id_for_upload_file_document_returns_string_id(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(data_source_info_dict={"upload_file_id": 99})

        result = DocumentService._get_upload_file_id_for_upload_file_document(
            document,
            invalid_source_message="invalid source",
            missing_file_message="missing file",
        )

        assert result == "99"

    def test_get_upload_file_for_upload_file_document_raises_when_file_service_returns_nothing(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            tenant_id="tenant-1",
            data_source_info_dict={"upload_file_id": "file-1"},
        )

        with patch("services.dataset_service.FileService.get_upload_files_by_ids", return_value={}):
            with pytest.raises(NotFound, match="Uploaded file not found"):
                DocumentService._get_upload_file_for_upload_file_document(document)

    def test_get_upload_file_for_upload_file_document_returns_upload_file(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            tenant_id="tenant-1",
            data_source_info_dict={"upload_file_id": "file-1"},
        )
        upload_file = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-1")

        with patch(
            "services.dataset_service.FileService.get_upload_files_by_ids", return_value={"file-1": upload_file}
        ):
            result = DocumentService._get_upload_file_for_upload_file_document(document)

        assert result is upload_file

    def test_enrich_documents_with_summary_index_status_skips_lookup_when_summary_is_disabled(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(summary_index_setting={"enable": False})
        documents = [
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1", need_summary=True),
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-2", need_summary=False),
        ]

        DocumentService.enrich_documents_with_summary_index_status(documents, dataset, tenant_id="tenant-1")

        assert documents[0].summary_index_status is None
        assert documents[1].summary_index_status is None

    def test_enrich_documents_with_summary_index_status_applies_summary_status_map(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            dataset_id="dataset-1",
            summary_index_setting={"enable": True},
        )
        documents = [
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1", need_summary=True),
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-2", need_summary=True),
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-3", need_summary=False),
        ]

        with patch(
            "services.summary_index_service.SummaryIndexService.get_documents_summary_index_status",
            return_value={"doc-1": "completed", "doc-2": None},
        ) as get_status_map:
            DocumentService.enrich_documents_with_summary_index_status(documents, dataset, tenant_id="tenant-1")

        get_status_map.assert_called_once_with(
            document_ids=["doc-1", "doc-2"],
            dataset_id="dataset-1",
            tenant_id="tenant-1",
        )
        assert documents[0].summary_index_status == "completed"
        assert documents[1].summary_index_status is None
        assert documents[2].summary_index_status is None

    def test_generate_document_batch_download_zip_filename_uses_zip_extension(self):
        fake_uuid = SimpleNamespace(hex="archive-id")

        with patch("services.dataset_service.uuid.uuid4", return_value=fake_uuid):
            result = DocumentService._generate_document_batch_download_zip_filename()

        assert result == "archive-id.zip"

    def test_get_upload_files_by_document_id_for_zip_download_raises_for_missing_documents(self):
        with patch.object(DocumentService, "get_documents_by_ids", return_value=[]):
            with pytest.raises(NotFound, match="Document not found"):
                DocumentService._get_upload_files_by_document_id_for_zip_download(
                    dataset_id="dataset-1",
                    document_ids=["doc-1"],
                    tenant_id="tenant-1",
                )

    def test_get_upload_files_by_document_id_for_zip_download_rejects_cross_tenant_access(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-1",
            tenant_id="tenant-other",
            data_source_info_dict={"upload_file_id": "file-1"},
        )

        with patch.object(DocumentService, "get_documents_by_ids", return_value=[document]):
            with pytest.raises(Forbidden, match="No permission"):
                DocumentService._get_upload_files_by_document_id_for_zip_download(
                    dataset_id="dataset-1",
                    document_ids=["doc-1"],
                    tenant_id="tenant-1",
                )

    def test_get_upload_files_by_document_id_for_zip_download_rejects_missing_upload_files(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-1",
            tenant_id="tenant-1",
            data_source_info_dict={"upload_file_id": "file-1"},
        )

        with (
            patch.object(DocumentService, "get_documents_by_ids", return_value=[document]),
            patch("services.dataset_service.FileService.get_upload_files_by_ids", return_value={}),
        ):
            with pytest.raises(NotFound, match="Only uploaded-file documents can be downloaded as ZIP"):
                DocumentService._get_upload_files_by_document_id_for_zip_download(
                    dataset_id="dataset-1",
                    document_ids=["doc-1"],
                    tenant_id="tenant-1",
                )

    def test_get_upload_files_by_document_id_for_zip_download_returns_document_keyed_mapping(self):
        document_a = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-1",
            tenant_id="tenant-1",
            data_source_info_dict={"upload_file_id": "file-1"},
        )
        document_b = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-2",
            tenant_id="tenant-1",
            data_source_info_dict={"upload_file_id": "file-2"},
        )
        upload_file_a = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-1")
        upload_file_b = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-2")

        with (
            patch.object(DocumentService, "get_documents_by_ids", return_value=[document_a, document_b]),
            patch(
                "services.dataset_service.FileService.get_upload_files_by_ids",
                return_value={"file-1": upload_file_a, "file-2": upload_file_b},
            ),
        ):
            result = DocumentService._get_upload_files_by_document_id_for_zip_download(
                dataset_id="dataset-1",
                document_ids=["doc-1", "doc-2"],
                tenant_id="tenant-1",
            )

        assert result == {"doc-1": upload_file_a, "doc-2": upload_file_b}

    def test_prepare_document_batch_download_zip_raises_not_found_for_missing_dataset(self):
        user = DatasetServiceUnitDataFactory.create_user_mock()

        with patch.object(DatasetService, "get_dataset", return_value=None):
            with pytest.raises(NotFound, match="Dataset not found"):
                DocumentService.prepare_document_batch_download_zip(
                    dataset_id="dataset-1",
                    document_ids=["doc-1"],
                    tenant_id="tenant-1",
                    current_user=user,
                )

    def test_prepare_document_batch_download_zip_translates_permission_error_to_forbidden(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()
        user = DatasetServiceUnitDataFactory.create_user_mock()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission", side_effect=NoPermissionError("blocked")),
        ):
            with pytest.raises(Forbidden, match="blocked"):
                DocumentService.prepare_document_batch_download_zip(
                    dataset_id=dataset.id,
                    document_ids=["doc-1"],
                    tenant_id="tenant-1",
                    current_user=user,
                )

    def test_prepare_document_batch_download_zip_returns_upload_files_in_requested_order(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()
        user = DatasetServiceUnitDataFactory.create_user_mock()
        upload_file_a = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-a")
        upload_file_b = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-b")

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission"),
            patch.object(
                DocumentService,
                "_get_upload_files_by_document_id_for_zip_download",
                return_value={"doc-1": upload_file_a, "doc-2": upload_file_b},
            ),
            patch.object(DocumentService, "_generate_document_batch_download_zip_filename", return_value="archive.zip"),
        ):
            upload_files, download_name = DocumentService.prepare_document_batch_download_zip(
                dataset_id=dataset.id,
                document_ids=["doc-2", "doc-1"],
                tenant_id="tenant-1",
                current_user=user,
            )

        assert upload_files == [upload_file_b, upload_file_a]
        assert download_name == "archive.zip"

    def test_get_document_by_dataset_id_returns_enabled_documents(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(enabled=True)

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [document]

            result = DocumentService.get_document_by_dataset_id("dataset-1")

        assert result == [document]

    def test_get_working_documents_by_dataset_id_returns_scalars_result(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="completed", archived=False)

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [document]

            result = DocumentService.get_working_documents_by_dataset_id("dataset-1")

        assert result == [document]

    def test_get_error_documents_by_dataset_id_returns_scalars_result(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="error")

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [document]

            result = DocumentService.get_error_documents_by_dataset_id("dataset-1")

        assert result == [document]

    def test_get_batch_documents_filters_by_current_user_tenant(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"
        document = DatasetServiceUnitDataFactory.create_document_mock()

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.db") as mock_db,
        ):
            mock_db.session.scalars.return_value.all.return_value = [document]

            result = DocumentService.get_batch_documents("dataset-1", "batch-1")

        assert result == [document]

    def test_get_document_file_detail_returns_one_or_none(self):
        upload_file = DatasetServiceUnitDataFactory.create_upload_file_mock()

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.one_or_none.return_value = upload_file

            result = DocumentService.get_document_file_detail(upload_file.id)

        assert result is upload_file


class TestDocumentServiceMutations:
    """Unit tests for DocumentService mutation and orchestration helpers."""

    @pytest.fixture
    def rename_account_context(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.id = "user-123"
        current_user.current_tenant_id = "tenant-123"

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
        ):
            yield current_user

    @pytest.mark.parametrize(("archived", "expected"), [(True, True), (False, False)])
    def test_check_archived_returns_boolean_status(self, archived, expected):
        document = DatasetServiceUnitDataFactory.create_document_mock(archived=archived)

        assert DocumentService.check_archived(document) is expected

    def test_delete_document_emits_signal_and_commits(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            data_source_type="upload_file",
            data_source_info='{"upload_file_id": "file-1"}',
            data_source_info_dict={"upload_file_id": "file-1"},
        )

        with (
            patch("services.dataset_service.document_was_deleted.send") as send_deleted_signal,
            patch("services.dataset_service.db") as mock_db,
        ):
            DocumentService.delete_document(document)

        send_deleted_signal.assert_called_once_with(
            document.id,
            dataset_id=document.dataset_id,
            doc_form=document.doc_form,
            file_id="file-1",
        )
        mock_db.session.delete.assert_called_once_with(document)
        mock_db.session.commit.assert_called_once()

    def test_delete_documents_ignores_empty_input(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()

        with patch("services.dataset_service.db") as mock_db:
            DocumentService.delete_documents(dataset, [])

        mock_db.session.scalars.assert_not_called()

    def test_delete_documents_deletes_rows_and_dispatches_cleanup_task(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(doc_form="text_model")
        document_a = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-1",
            data_source_type="upload_file",
            data_source_info_dict={"upload_file_id": "file-1"},
        )
        document_b = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-2",
            data_source_type="upload_file",
            data_source_info_dict={"upload_file_id": "file-2"},
        )

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.batch_clean_document_task") as clean_task,
        ):
            mock_db.session.scalars.return_value.all.return_value = [document_a, document_b]

            DocumentService.delete_documents(dataset, ["doc-1", "doc-2"])

        assert mock_db.session.delete.call_count == 2
        mock_db.session.commit.assert_called_once()
        clean_task.delay.assert_called_once_with(["doc-1", "doc-2"], dataset.id, dataset.doc_form, ["file-1", "file-2"])

    def test_rename_document_raises_when_dataset_is_missing(self, rename_account_context):
        with patch.object(DatasetService, "get_dataset", return_value=None):
            with pytest.raises(ValueError, match="Dataset not found"):
                DocumentService.rename_document("dataset-1", "doc-1", "New Name")

    def test_rename_document_raises_when_document_is_missing(self, rename_account_context):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DocumentService, "get_document", return_value=None),
        ):
            with pytest.raises(ValueError, match="Document not found"):
                DocumentService.rename_document(dataset.id, "doc-1", "New Name")

    def test_rename_document_rejects_cross_tenant_access(self, rename_account_context):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()
        document = DatasetServiceUnitDataFactory.create_document_mock(tenant_id="tenant-other")

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DocumentService, "get_document", return_value=document),
        ):
            with pytest.raises(ValueError, match="No permission"):
                DocumentService.rename_document(dataset.id, document.id, "New Name")

    def test_rename_document_updates_document_metadata_and_upload_file_name(self, rename_account_context):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            built_in_field_enabled=True,
            tenant_id="tenant-1",
        )
        document = DatasetServiceUnitDataFactory.create_document_mock(
            tenant_id="tenant-1",
            doc_metadata={"title": "Old"},
            data_source_info_dict={"upload_file_id": "file-1"},
        )
        rename_account_context.current_tenant_id = "tenant-1"

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DocumentService, "get_document", return_value=document),
            patch("services.dataset_service.db") as mock_db,
        ):
            result = DocumentService.rename_document(dataset.id, document.id, "New Name")

        assert result is document
        assert document.name == "New Name"
        assert document.doc_metadata[BuiltInField.document_name] == "New Name"
        mock_db.session.add.assert_called_once_with(document)
        mock_db.session.query.return_value.where.return_value.update.assert_called_once()
        mock_db.session.commit.assert_called_once()

    def test_recover_document_raises_when_document_is_not_paused(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(is_paused=False)

        with pytest.raises(DocumentIndexingError):
            DocumentService.recover_document(document)

    def test_retry_document_raises_when_retry_flag_is_already_set(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1")

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = "1"

            with pytest.raises(ValueError, match="being retried"):
                DocumentService.retry_document("dataset-1", [document])

    def test_sync_website_document_raises_when_sync_flag_exists(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1")

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = "1"

            with pytest.raises(ValueError, match="being synced"):
                DocumentService.sync_website_document("dataset-1", document)

    def test_sync_website_document_updates_status_sets_cache_and_dispatches_task(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-1",
            data_source_info_dict={"mode": "crawl"},
        )
        document.data_source_info = "{}"

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.sync_website_document_indexing_task") as sync_task,
        ):
            mock_redis.get.return_value = None

            DocumentService.sync_website_document("dataset-1", document)

        assert document.indexing_status == "waiting"
        assert '"mode": "scrape"' in document.data_source_info
        mock_db.session.add.assert_called_once_with(document)
        mock_db.session.commit.assert_called_once()
        mock_redis.setex.assert_called_once_with("document_doc-1_is_sync", 600, 1)
        sync_task.delay.assert_called_once_with("dataset-1", "doc-1")

    def test_get_documents_position_returns_next_position_when_documents_exist(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(position=7)

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.order_by.return_value.first.return_value = (
                document
            )

            result = DocumentService.get_documents_position("dataset-1")

        assert result == 8

    def test_get_documents_position_defaults_to_one_when_dataset_is_empty(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.order_by.return_value.first.return_value = None

            result = DocumentService.get_documents_position("dataset-1")

        assert result == 1


class TestDocumentServiceSaveDocumentWithoutDatasetId:
    """Unit tests for dataset creation around save_document_without_dataset_id."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_save_document_without_dataset_id_creates_high_quality_dataset_with_default_retrieval_model(
        self, account_context
    ):
        knowledge_config = KnowledgeConfig(
            indexing_technique="high_quality",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            embedding_model="embedding-model",
            embedding_model_provider="provider",
            summary_index_setting={"enable": True},
            is_multimodal=True,
        )
        created_dataset = SimpleNamespace(
            id="dataset-1",
            tenant_id="tenant-1",
            name="",
            description=None,
        )
        first_document = SimpleNamespace(name="VeryLongDocumentNameForDataset.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-1"),
            ),
            patch(
                "services.dataset_service.Dataset",
                side_effect=lambda **kwargs: created_dataset.__dict__.update(kwargs) or created_dataset,
            ) as dataset_cls,
            patch.object(
                DocumentService, "save_document_with_dataset_id", return_value=([first_document], "batch-1")
            ) as save_document,
            patch("services.dataset_service.db") as mock_db,
        ):
            dataset, documents, batch = DocumentService.save_document_without_dataset_id(
                tenant_id="tenant-1",
                knowledge_config=knowledge_config,
                account=account_context,
            )

        assert dataset is created_dataset
        assert documents == [first_document]
        assert batch == "batch-1"
        assert created_dataset.collection_binding_id == "binding-1"
        assert created_dataset.retrieval_model["search_method"] == RetrievalMethod.SEMANTIC_SEARCH
        assert created_dataset.retrieval_model["top_k"] == 4
        assert created_dataset.summary_index_setting == {"enable": True}
        assert created_dataset.is_multimodal is True
        assert created_dataset.name == first_document.name[:18] + "..."
        assert (
            created_dataset.description
            == "useful for when you want to answer queries about the VeryLongDocumentNameForDataset.txt"
        )
        dataset_cls.assert_called_once()
        save_document.assert_called_once_with(created_dataset, knowledge_config, account_context)
        assert mock_db.session.commit.call_count == 1

    def test_save_document_without_dataset_id_uses_provided_retrieval_model(self, account_context):
        retrieval_model = RetrievalModel(
            search_method=RetrievalMethod.SEMANTIC_SEARCH,
            reranking_enable=True,
            reranking_model=RerankingModel(
                reranking_provider_name="rerank-provider",
                reranking_model_name="rerank-model",
            ),
            top_k=9,
            score_threshold_enabled=True,
            score_threshold=0.6,
        )
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            retrieval_model=retrieval_model,
        )
        created_dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1", name="", description=None)

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch(
                "services.dataset_service.Dataset",
                side_effect=lambda **kwargs: created_dataset.__dict__.update(kwargs) or created_dataset,
            ),
            patch.object(
                DocumentService,
                "save_document_with_dataset_id",
                return_value=([SimpleNamespace(name="Doc")], "batch-1"),
            ),
            patch("services.dataset_service.db"),
        ):
            DocumentService.save_document_without_dataset_id("tenant-1", knowledge_config, account_context)

        assert created_dataset.retrieval_model == retrieval_model.model_dump()
        assert created_dataset.collection_binding_id is None

    def test_save_document_without_dataset_id_rejects_sandbox_batch_upload(self, account_context):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1", "file-2"]),
                )
            ),
        )

        with (
            patch(
                "services.dataset_service.FeatureService.get_features",
                return_value=_make_features(enabled=True, plan=CloudPlan.SANDBOX),
            ),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="does not support batch upload"):
                DocumentService.save_document_without_dataset_id("tenant-1", knowledge_config, account_context)

        check_quota.assert_not_called()


class TestDocumentServiceUpdateDocumentWithDatasetId:
    """Unit tests for the document-update orchestration path."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_update_document_with_dataset_id_raises_when_document_is_missing(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=None),
            patch.object(DatasetService, "check_dataset_model_setting") as check_model_setting,
        ):
            with pytest.raises(NotFound, match="Document not found"):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

        check_model_setting.assert_called_once_with(dataset)

    def test_update_document_with_dataset_id_rejects_non_available_documents(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = SimpleNamespace(display_status="indexing")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch.object(DatasetService, "check_dataset_model_setting"),
        ):
            with pytest.raises(ValueError, match="Document is not available"):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

    def test_update_document_with_dataset_id_upload_file_process_rule_and_name_override(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = _make_document()
        document.dataset_process_rule_id = "old-rule"
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="custom",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
            name="Renamed document",
            doc_form=IndexStructureType.QA_INDEX,
        )
        created_process_rule = SimpleNamespace(id="rule-2")

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.DatasetProcessRule", return_value=created_process_rule),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            upload_query = MagicMock()
            upload_query.where.return_value.first.return_value = SimpleNamespace(id="file-1", name="upload.txt")
            segment_query = MagicMock()
            segment_query.filter_by.return_value.update.return_value = 3
            mock_db.session.query.side_effect = [upload_query, segment_query]

            result = DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

        assert result is document
        assert document.dataset_process_rule_id == "rule-2"
        assert document.data_source_type == "upload_file"
        assert document.data_source_info == '{"upload_file_id": "file-1"}'
        assert document.name == "Renamed document"
        assert document.indexing_status == "waiting"
        assert document.completed_at is None
        assert document.processing_started_at is None
        assert document.parsing_completed_at is None
        assert document.cleaning_completed_at is None
        assert document.splitting_completed_at is None
        assert document.updated_at == "now"
        assert document.created_from == "web"
        assert document.doc_form == IndexStructureType.QA_INDEX
        assert mock_db.session.commit.call_count == 3
        segment_query.filter_by.return_value.update.assert_called_once()
        update_task.delay.assert_called_once_with(document.dataset_id, document.id)

    def test_update_document_with_dataset_id_notion_import_requires_binding(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = SimpleNamespace(display_status="available", id="doc-1", dataset_id="dataset-1")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page")],
                        )
                    ],
                )
            ),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.db") as mock_db,
        ):
            binding_query = MagicMock()
            binding_query.where.return_value.first.return_value = None
            mock_db.session.query.return_value = binding_query

            with pytest.raises(ValueError, match="Data source binding not found"):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

    def test_update_document_with_dataset_id_website_crawl_updates_segments_and_dispatches_task(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = _make_document()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="website_crawl",
                    website_info_list=WebsiteInfo(
                        provider="firecrawl",
                        job_id="job-1",
                        urls=["https://example.com"],
                        only_main_content=False,
                    ),
                )
            ),
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
        )

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            segment_query = MagicMock()
            segment_query.filter_by.return_value.update.return_value = 2
            mock_db.session.query.return_value = segment_query

            result = DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

        assert result is document
        assert document.data_source_type == "website_crawl"
        assert document.data_source_info == (
            '{"url": "https://example.com", "provider": "firecrawl", "job_id": "job-1", '
            '"only_main_content": false, "mode": "crawl"}'
        )
        assert document.name == ""
        assert document.doc_form == IndexStructureType.PARENT_CHILD_INDEX
        segment_query.filter_by.return_value.update.assert_called_once()
        update_task.delay.assert_called_once_with("dataset-1", "doc-1")


class TestDocumentServiceCreateValidation:
    """Unit tests for document creation validation helpers."""

    def test_document_create_args_validate_requires_data_source_or_process_rule(self):
        knowledge_config = SimpleNamespace(data_source=None, process_rule=None)

        with pytest.raises(ValueError, match="Data source or Process rule is required"):
            DocumentService.document_create_args_validate(knowledge_config)

    def test_document_create_args_validate_delegates_to_sub_validators(self):
        knowledge_config = SimpleNamespace(data_source=object(), process_rule=object())

        with (
            patch.object(DocumentService, "data_source_args_validate") as validate_data_source,
            patch.object(DocumentService, "process_rule_args_validate") as validate_process_rule,
        ):
            DocumentService.document_create_args_validate(knowledge_config)

        validate_data_source.assert_called_once_with(knowledge_config)
        validate_process_rule.assert_called_once_with(knowledge_config)

    def test_data_source_args_validate_rejects_invalid_type(self):
        knowledge_config = SimpleNamespace(
            data_source=SimpleNamespace(
                info_list=SimpleNamespace(
                    data_source_type="bad-source",
                    file_info_list=None,
                    notion_info_list=None,
                    website_info_list=None,
                )
            )
        )

        with pytest.raises(ValueError, match="Data source type is invalid"):
            DocumentService.data_source_args_validate(knowledge_config)

    @pytest.mark.parametrize(
        ("data_source_type", "field_name", "message"),
        [
            ("upload_file", "file_info_list", "File source info is required"),
            ("notion_import", "notion_info_list", "Notion source info is required"),
            ("website_crawl", "website_info_list", "Website source info is required"),
        ],
    )
    def test_data_source_args_validate_requires_source_specific_info(self, data_source_type, field_name, message):
        info_list = SimpleNamespace(
            data_source_type=data_source_type,
            file_info_list=object(),
            notion_info_list=object(),
            website_info_list=object(),
        )
        setattr(info_list, field_name, None)
        knowledge_config = SimpleNamespace(data_source=SimpleNamespace(info_list=info_list))

        with pytest.raises(ValueError, match=message):
            DocumentService.data_source_args_validate(knowledge_config)

    def test_process_rule_args_validate_clears_rules_for_automatic_mode(self):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="automatic",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
        )

        DocumentService.process_rule_args_validate(knowledge_config)

        assert knowledge_config.process_rule is not None
        assert knowledge_config.process_rule.rules is None

    def test_process_rule_args_validate_deduplicates_rules_and_skips_max_tokens_for_full_doc_hierarchical(self):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="hierarchical",
                rules=Rule(
                    pre_processing_rules=[
                        PreProcessingRule(id="remove_stopwords", enabled=True),
                        PreProcessingRule(id="remove_stopwords", enabled=False),
                    ],
                    segmentation=Segmentation(separator="\n", max_tokens=0),
                    parent_mode="full-doc",
                ),
            ),
        )

        DocumentService.process_rule_args_validate(knowledge_config)

        assert knowledge_config.process_rule is not None
        assert knowledge_config.process_rule.rules is not None
        assert len(knowledge_config.process_rule.rules.pre_processing_rules) == 1
        assert knowledge_config.process_rule.rules.pre_processing_rules[0].enabled is False


class TestDocumentServiceSaveDocumentWithDatasetId:
    """Unit tests for non-SQL validation branches in save_document_with_dataset_id."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with (
            patch("services.dataset_service.current_user", account),
            patch.object(DatasetService, "check_doc_form"),
        ):
            yield account

    def test_save_document_with_dataset_id_requires_file_info_for_upload_source(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(file_ids=None)

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=True)):
            with pytest.raises(ValueError, match="File source info is required"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_blocks_batch_upload_for_sandbox_plan(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])

        with (
            patch(
                "services.dataset_service.FeatureService.get_features",
                return_value=_make_features(enabled=True, plan=CloudPlan.SANDBOX),
            ),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="does not support batch upload"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        check_quota.assert_not_called()

    def test_save_document_with_dataset_id_enforces_batch_upload_limit(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=True)),
            patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 1),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="batch upload limit of 1"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        check_quota.assert_not_called()

    def test_save_document_with_dataset_id_updates_existing_document_and_data_source_type(self, account_context):
        dataset = _make_dataset(data_source_type=None)
        knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
        updated_document = _make_document(document_id="doc-1", batch="batch-existing")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch.object(
                DocumentService, "update_document_with_dataset_id", return_value=updated_document
            ) as update_document,
        ):
            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert dataset.data_source_type == "upload_file"
        assert documents == [updated_document]
        assert batch == "batch-existing"
        update_document.assert_called_once_with(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_requires_data_source_for_new_documents(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(data_source=None)

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            with pytest.raises(ValueError, match="Data source is required when creating new documents"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_requires_existing_process_rule_for_custom_mode(self, account_context):
        dataset = _make_dataset(latest_process_rule=None)
        knowledge_config = _make_upload_knowledge_config(
            file_ids=["file-1"],
            process_rule=ProcessRule(mode="custom"),
        )

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            with pytest.raises(ValueError, match="No process rule found"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_rejects_invalid_indexing_technique(self, account_context):
        dataset = _make_dataset(indexing_technique=None)
        knowledge_config = SimpleNamespace(
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            original_document_id=None,
            data_source=None,
            indexing_technique="broken-technique",
        )

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            with pytest.raises(ValueError, match="Indexing technique is invalid"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_returns_empty_for_invalid_process_rule_mode(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1"])
        knowledge_config.process_rule = SimpleNamespace(mode="unsupported-mode", rules=None)

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert documents == []
        assert batch == ""

    def test_save_document_with_dataset_id_upload_file_creates_and_reindexes_documents(self, account_context):
        dataset = _make_dataset()
        dataset_process_rule = SimpleNamespace(id="rule-1")
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])
        duplicate_document = _make_document(document_id="doc-duplicate", name="existing.txt")
        created_document = _make_document(document_id="doc-created", name="new.txt")
        upload_file_a = SimpleNamespace(id="file-1", name="existing.txt")
        upload_file_b = SimpleNamespace(id="file-2", name="new.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch.object(DocumentService, "get_documents_position", return_value=4),
            patch.object(DocumentService, "build_document", return_value=created_document) as build_document,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
            patch("services.dataset_service.DuplicateDocumentIndexingTaskProxy") as duplicate_proxy_cls,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            upload_query = MagicMock()
            upload_query.where.return_value.all.return_value = [upload_file_a, upload_file_b]
            existing_documents_query = MagicMock()
            existing_documents_query.where.return_value.all.return_value = [duplicate_document]
            mock_db.session.query.side_effect = [upload_query, existing_documents_query]

            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                dataset_process_rule=dataset_process_rule,
            )

        assert documents == [duplicate_document, created_document]
        assert batch == "20260101010101100023"
        assert duplicate_document.dataset_process_rule_id == "rule-1"
        assert duplicate_document.updated_at == "now"
        assert duplicate_document.batch == batch
        assert duplicate_document.indexing_status == "waiting"
        build_document.assert_called_once_with(
            dataset,
            "rule-1",
            "upload_file",
            IndexStructureType.PARAGRAPH_INDEX,
            "English",
            {"upload_file_id": "file-2"},
            "web",
            4,
            account_context,
            "new.txt",
            batch,
        )
        document_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-created"])
        document_proxy_cls.return_value.delay.assert_called_once()
        duplicate_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-duplicate"])
        duplicate_proxy_cls.return_value.delay.assert_called_once()

    def test_save_document_with_dataset_id_notion_import_truncates_names_and_cleans_removed_pages(
        self, account_context
    ):
        dataset = _make_dataset()
        dataset_process_rule = SimpleNamespace(id="rule-1")
        notion_page_name = "a" * 300
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[
                                NotionPage(page_id="page-keep", page_name="Keep page", type="page"),
                                NotionPage(
                                    page_id="page-new",
                                    page_name=notion_page_name,
                                    page_icon=NotionIcon(type="emoji", emoji="page"),
                                    type="page",
                                ),
                            ],
                        )
                    ],
                )
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )
        existing_keep = _make_document(document_id="doc-keep")
        existing_keep.data_source_info = json.dumps({"notion_page_id": "page-keep"})
        existing_remove = _make_document(document_id="doc-remove")
        existing_remove.data_source_info = json.dumps({"notion_page_id": "page-remove"})
        created_document = _make_document(document_id="doc-new")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch.object(DocumentService, "get_documents_position", return_value=1),
            patch.object(DocumentService, "build_document", return_value=created_document) as build_document,
            patch("services.dataset_service.clean_notion_document_task") as clean_task,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
        ):
            mock_redis.lock.return_value = _make_lock_context()
            notion_documents_query = MagicMock()
            notion_documents_query.filter_by.return_value.all.return_value = [existing_keep, existing_remove]
            mock_db.session.query.return_value = notion_documents_query

            documents, _ = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                dataset_process_rule=dataset_process_rule,
            )

        assert created_document in documents
        assert len(build_document.call_args.args[9]) == 255
        clean_task.delay.assert_called_once_with(["doc-remove"], dataset.id)
        document_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-new"])
        document_proxy_cls.return_value.delay.assert_called_once()

    def test_save_document_with_dataset_id_website_crawl_truncates_long_urls(self, account_context):
        dataset = _make_dataset()
        dataset_process_rule = SimpleNamespace(id="rule-1")
        long_url = "https://example.com/" + ("a" * 260)
        short_url = "https://example.com/short"
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="website_crawl",
                    website_info_list=WebsiteInfo(
                        provider="firecrawl",
                        job_id="job-1",
                        urls=[long_url, short_url],
                        only_main_content=True,
                    ),
                )
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )
        first_document = _make_document(document_id="doc-1")
        second_document = _make_document(document_id="doc-2")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch.object(DocumentService, "get_documents_position", return_value=2),
            patch.object(
                DocumentService,
                "build_document",
                side_effect=[first_document, second_document],
            ) as build_document,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
        ):
            mock_redis.lock.return_value = _make_lock_context()

            documents, _ = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                dataset_process_rule=dataset_process_rule,
            )

        assert documents == [first_document, second_document]
        assert build_document.call_args_list[0].args[9] == long_url[:200] + "..."
        assert build_document.call_args_list[1].args[9] == short_url
        document_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-1", "doc-2"])
        document_proxy_cls.return_value.delay.assert_called_once()


class TestDocumentServiceBatchUpdateStatus:
    """Unit tests for batch_update_document_status orchestration and helper branches."""

    def test_prepare_disable_update_requires_completed_document(self):
        document = _make_document(indexing_status="waiting")
        document.completed_at = None

        with pytest.raises(DocumentIndexingError, match="is not completed"):
            DocumentService._prepare_disable_update(document, user=SimpleNamespace(id="user-1"), now="now")

    def test_prepare_archive_update_sets_async_task_for_enabled_document(self):
        document = _make_document(enabled=True, archived=False)

        result = DocumentService._prepare_archive_update(document, user=SimpleNamespace(id="user-1"), now="now")

        assert result is not None
        assert result["updates"]["archived"] is True
        assert result["set_cache"] is True
        assert result["async_task"]["args"] == [document.id]

    def test_prepare_unarchive_update_sets_async_task_for_enabled_document(self):
        document = _make_document(enabled=True, archived=True)

        result = DocumentService._prepare_unarchive_update(document, now="now")

        assert result is not None
        assert result["updates"]["archived"] is False
        assert result["set_cache"] is True
        assert result["async_task"]["args"] == [document.id]

    def test_batch_update_document_status_rejects_indexing_documents(self):
        dataset = _make_dataset()
        document = _make_document(name="Busy document")

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
        ):
            mock_redis.get.return_value = "1"

            with pytest.raises(DocumentIndexingError, match="Busy document is being indexed"):
                DocumentService.batch_update_document_status(
                    dataset, [document.id], "archive", SimpleNamespace(id="user-1")
                )

        mock_db.session.commit.assert_not_called()

    def test_batch_update_document_status_rolls_back_when_commit_fails(self):
        dataset = _make_dataset()
        document = _make_document(enabled=False)

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
        ):
            mock_redis.get.return_value = None
            mock_db.session.commit.side_effect = RuntimeError("commit failed")

            with pytest.raises(RuntimeError, match="commit failed"):
                DocumentService.batch_update_document_status(
                    dataset, [document.id], "enable", SimpleNamespace(id="user-1")
                )

        mock_db.session.rollback.assert_called_once()

    def test_batch_update_document_status_raises_async_task_error_after_commit(self):
        dataset = _make_dataset()
        document = _make_document(enabled=False)

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.add_document_to_index_task") as add_task,
        ):
            mock_redis.get.return_value = None
            add_task.delay.side_effect = RuntimeError("task failed")

            with pytest.raises(RuntimeError, match="task failed"):
                DocumentService.batch_update_document_status(
                    dataset, [document.id], "enable", SimpleNamespace(id="user-1")
                )

        mock_db.session.commit.assert_called_once()
        mock_redis.setex.assert_called_once_with(f"document_{document.id}_indexing", 600, 1)


class TestDocumentServiceTenantAndUpdateEdges:
    """Unit tests for tenant-count and update edge cases."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_get_tenant_documents_count_returns_query_count(self, account_context):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.count.return_value = 12

            result = DocumentService.get_tenant_documents_count()

        assert result == 12
        mock_db.session.query.return_value.where.return_value.count.assert_called_once()

    def test_update_document_with_dataset_id_uses_automatic_process_rule_payload(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = _make_document()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="automatic",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        created_process_rule = SimpleNamespace(id="rule-2")

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch("services.dataset_service.DatasetProcessRule") as process_rule_cls,
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            process_rule_cls.AUTOMATIC_RULES = DatasetProcessRule.AUTOMATIC_RULES
            process_rule_cls.return_value = created_process_rule
            upload_query = MagicMock()
            upload_query.where.return_value.first.return_value = SimpleNamespace(id="file-1", name="upload.txt")
            segment_query = MagicMock()
            segment_query.filter_by.return_value.update.return_value = 1
            mock_db.session.query.side_effect = [upload_query, segment_query]

            result = DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

        assert result is document
        assert document.dataset_process_rule_id == "rule-2"
        assert document.name == "upload.txt"
        assert process_rule_cls.call_args.kwargs == {
            "dataset_id": "dataset-1",
            "mode": "automatic",
            "rules": json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
            "created_by": "user-1",
        }
        assert mock_db.session.commit.call_count == 3
        update_task.delay.assert_called_once_with("dataset-1", "doc-1")

    def test_update_document_with_dataset_id_requires_upload_file_info(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="upload_file")),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=_make_document()),
            patch.object(DatasetService, "check_dataset_model_setting"),
        ):
            with pytest.raises(ValueError, match="No file info list found"):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

    def test_update_document_with_dataset_id_raises_when_upload_file_is_missing(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=_make_document()),
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.db") as mock_db,
        ):
            mock_db.session.query.return_value.where.return_value.first.return_value = None

            with pytest.raises(FileNotExistsError):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

    def test_update_document_with_dataset_id_requires_notion_info_list(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="notion_import")),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=_make_document()),
            patch.object(DatasetService, "check_dataset_model_setting"),
        ):
            with pytest.raises(ValueError, match="No notion info list found"):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

    def test_update_document_with_dataset_id_notion_import_updates_page_info(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = _make_document()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[
                                NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page"),
                                NotionPage(page_id="page-2", page_name="Page 2", page_icon=None, type="database"),
                            ],
                        )
                    ],
                )
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            binding_query = MagicMock()
            binding_query.where.return_value.first.return_value = SimpleNamespace(id="binding-1")
            segment_query = MagicMock()
            segment_query.filter_by.return_value.update.return_value = 1
            mock_db.session.query.side_effect = [binding_query, segment_query]

            result = DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

        assert result is document
        assert document.data_source_type == "notion_import"
        assert document.name == ""
        assert document.data_source_info == json.dumps(
            {
                "credential_id": "credential-1",
                "notion_workspace_id": "workspace-1",
                "notion_page_id": "page-2",
                "notion_page_icon": None,
                "type": "database",
            }
        )
        update_task.delay.assert_called_once_with("dataset-1", "doc-1")


class TestDocumentServiceSaveWithoutDatasetBilling:
    """Unit tests for batch-count and quota branches in save_document_without_dataset_id."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_save_document_without_dataset_id_counts_notion_pages_for_quota(self, account_context):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[
                                NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page"),
                                NotionPage(page_id="page-2", page_name="Page 2", page_icon=None, type="page"),
                            ],
                        ),
                        NotionInfo(
                            credential_id="credential-2",
                            workspace_id="workspace-2",
                            pages=[NotionPage(page_id="page-3", page_name="Page 3", page_icon=None, type="page")],
                        ),
                    ],
                )
            ),
        )
        created_dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1", name="", description=None)
        features = _make_features(enabled=True)

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=features),
            patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", "10"),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
            patch(
                "services.dataset_service.Dataset",
                side_effect=lambda **kwargs: created_dataset.__dict__.update(kwargs) or created_dataset,
            ),
            patch.object(
                DocumentService,
                "save_document_with_dataset_id",
                return_value=([SimpleNamespace(name="Doc")], "batch-1"),
            ),
            patch("services.dataset_service.db"),
        ):
            DocumentService.save_document_without_dataset_id("tenant-1", knowledge_config, account_context)

        check_quota.assert_called_once_with(3, features)

    def test_save_document_without_dataset_id_enforces_batch_limit_for_website_urls(self, account_context):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="website_crawl",
                    website_info_list=WebsiteInfo(
                        provider="firecrawl",
                        job_id="job-1",
                        urls=["https://example.com/a", "https://example.com/b"],
                        only_main_content=True,
                    ),
                )
            ),
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=True)),
            patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", "1"),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="batch upload limit of 1"):
                DocumentService.save_document_without_dataset_id("tenant-1", knowledge_config, account_context)

        check_quota.assert_not_called()


class TestDocumentServiceEstimateValidation:
    """Unit tests for estimate_args_validate branches."""

    def test_estimate_args_validate_rejects_missing_info_list(self):
        with pytest.raises(ValueError, match="Data source info is required"):
            DocumentService.estimate_args_validate({})

    def test_estimate_args_validate_sets_empty_rules_for_automatic_mode(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {"mode": "automatic", "rules": {"ignored": True}},
        }

        DocumentService.estimate_args_validate(args)

        assert args["process_rule"]["rules"] == {}

    def test_estimate_args_validate_rejects_unknown_pre_processing_rule_id(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [{"id": "unknown", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
            },
        }

        with pytest.raises(ValueError, match="pre_processing_rules id is invalid"):
            DocumentService.estimate_args_validate(args)

    def test_estimate_args_validate_deduplicates_rules_for_custom_mode(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [
                        {"id": "remove_stopwords", "enabled": True},
                        {"id": "remove_stopwords", "enabled": False},
                    ],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
            },
        }

        DocumentService.estimate_args_validate(args)

        assert args["process_rule"]["rules"]["pre_processing_rules"] == [{"id": "remove_stopwords", "enabled": False}]

    def test_estimate_args_validate_requires_summary_index_provider_name(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
                "summary_index_setting": {"enable": True, "model_name": "summary-model"},
            },
        }

        with pytest.raises(ValueError, match="Summary index model provider name is required"):
            DocumentService.estimate_args_validate(args)


class TestDocumentServiceSaveDocumentAdditionalBranches:
    """Additional unit tests for dataset bootstrap and process-rule branches."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with (
            patch("services.dataset_service.current_user", account),
            patch.object(DatasetService, "check_doc_form"),
        ):
            yield account

    def test_save_document_with_dataset_id_initializes_high_quality_dataset_from_default_embedding_model(
        self, account_context
    ):
        dataset = _make_dataset(data_source_type=None, indexing_technique=None)
        knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.embedding_model = None
        knowledge_config.embedding_model_provider = None
        updated_document = _make_document(batch="batch-existing")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-1"),
            ) as get_binding,
            patch.object(DocumentService, "update_document_with_dataset_id", return_value=updated_document),
        ):
            model_manager_cls.for_tenant.return_value.get_default_model_instance.return_value = SimpleNamespace(
                model_name="default-embedding",
                provider="default-provider",
            )

            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert documents == [updated_document]
        assert batch == "batch-existing"
        assert dataset.data_source_type == "upload_file"
        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == "default-embedding"
        assert dataset.embedding_model_provider == "default-provider"
        assert dataset.collection_binding_id == "binding-1"
        assert dataset.retrieval_model == {
            "search_method": "semantic_search",
            "reranking_enable": False,
            "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
            "top_k": 4,
            "score_threshold_enabled": False,
        }
        get_binding.assert_called_once_with("default-provider", "default-embedding")

    def test_save_document_with_dataset_id_uses_explicit_embedding_and_retrieval_model(self, account_context):
        dataset = _make_dataset(indexing_technique=None)
        knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.embedding_model = "explicit-model"
        knowledge_config.embedding_model_provider = "explicit-provider"
        knowledge_config.retrieval_model = RetrievalModel(
            search_method="semantic_search",
            reranking_enable=True,
            reranking_model=RerankingModel(
                reranking_provider_name="rerank-provider",
                reranking_model_name="rerank-model",
            ),
            top_k=7,
            score_threshold_enabled=True,
            score_threshold=0.3,
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-2"),
            ) as get_binding,
            patch.object(DocumentService, "update_document_with_dataset_id", return_value=_make_document()),
        ):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        model_manager_cls.for_tenant.return_value.get_default_model_instance.assert_not_called()
        get_binding.assert_called_once_with("explicit-provider", "explicit-model")
        assert dataset.embedding_model == "explicit-model"
        assert dataset.embedding_model_provider == "explicit-provider"
        assert dataset.retrieval_model == knowledge_config.retrieval_model.model_dump()

    def test_save_document_with_dataset_id_creates_custom_process_rule_for_new_upload_document(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(
            file_ids=["file-1"],
            process_rule=ProcessRule(
                mode="custom",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
        )
        created_process_rule = SimpleNamespace(id="rule-custom")
        created_document = _make_document(document_id="doc-created", name="file.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.DatasetProcessRule") as process_rule_cls,
            patch.object(DocumentService, "get_documents_position", return_value=3),
            patch.object(DocumentService, "build_document", return_value=created_document),
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            process_rule_cls.return_value = created_process_rule
            upload_query = MagicMock()
            upload_query.where.return_value.all.return_value = [SimpleNamespace(id="file-1", name="file.txt")]
            existing_documents_query = MagicMock()
            existing_documents_query.where.return_value.all.return_value = []
            mock_db.session.query.side_effect = [upload_query, existing_documents_query]

            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert documents == [created_document]
        assert batch == "20260101010101100023"
        assert process_rule_cls.call_args.kwargs == {
            "dataset_id": "dataset-1",
            "mode": "custom",
            "rules": knowledge_config.process_rule.rules.model_dump_json(),
            "created_by": "user-1",
        }
        document_proxy_cls.assert_called_once_with("tenant-1", "dataset-1", ["doc-created"])
        document_proxy_cls.return_value.delay.assert_called_once()

    def test_save_document_with_dataset_id_creates_automatic_process_rule_for_new_upload_document(
        self, account_context
    ):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(
            file_ids=["file-1"],
            process_rule=ProcessRule(mode="automatic"),
        )
        created_process_rule = SimpleNamespace(id="rule-auto")
        created_document = _make_document(document_id="doc-created", name="file.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.DatasetProcessRule") as process_rule_cls,
            patch.object(DocumentService, "get_documents_position", return_value=1),
            patch.object(DocumentService, "build_document", return_value=created_document),
            patch("services.dataset_service.DocumentIndexingTaskProxy"),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            process_rule_cls.AUTOMATIC_RULES = DatasetProcessRule.AUTOMATIC_RULES
            process_rule_cls.return_value = created_process_rule
            upload_query = MagicMock()
            upload_query.where.return_value.all.return_value = [SimpleNamespace(id="file-1", name="file.txt")]
            existing_documents_query = MagicMock()
            existing_documents_query.where.return_value.all.return_value = []
            mock_db.session.query.side_effect = [upload_query, existing_documents_query]

            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert process_rule_cls.call_args.kwargs == {
            "dataset_id": "dataset-1",
            "mode": "automatic",
            "rules": json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
            "created_by": "user-1",
        }
        assert mock_db.session.flush.call_count >= 2

    def test_save_document_with_dataset_id_creates_fallback_automatic_process_rule_when_latest_is_missing(
        self, account_context
    ):
        dataset = _make_dataset(latest_process_rule=None)
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1"], process_rule=None)
        created_process_rule = SimpleNamespace(id="rule-fallback")
        created_document = _make_document(document_id="doc-created", name="file.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.DatasetProcessRule") as process_rule_cls,
            patch.object(DocumentService, "get_documents_position", return_value=1),
            patch.object(DocumentService, "build_document", return_value=created_document),
            patch("services.dataset_service.DocumentIndexingTaskProxy"),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            process_rule_cls.AUTOMATIC_RULES = DatasetProcessRule.AUTOMATIC_RULES
            process_rule_cls.return_value = created_process_rule
            upload_query = MagicMock()
            upload_query.where.return_value.all.return_value = [SimpleNamespace(id="file-1", name="file.txt")]
            existing_documents_query = MagicMock()
            existing_documents_query.where.return_value.all.return_value = []
            mock_db.session.query.side_effect = [upload_query, existing_documents_query]

            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert process_rule_cls.call_args.kwargs == {
            "dataset_id": "dataset-1",
            "mode": "automatic",
            "rules": json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
            "created_by": "user-1",
        }

    def test_save_document_with_dataset_id_raises_when_upload_file_lookup_is_incomplete(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch.object(DocumentService, "get_documents_position", return_value=1),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            upload_query = MagicMock()
            upload_query.where.return_value.all.return_value = [SimpleNamespace(id="file-1", name="file.txt")]
            mock_db.session.query.return_value = upload_query

            with pytest.raises(FileNotExistsError, match="One or more files not found"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_requires_notion_info_list_for_notion_import(self, account_context):
        dataset = _make_dataset()
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="notion_import")),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch.object(DocumentService, "get_documents_position", return_value=1),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            with pytest.raises(ValueError, match="No notion info list found"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    dataset_process_rule=SimpleNamespace(id="rule-1"),
                )

    def test_save_document_with_dataset_id_requires_website_info_list_for_website_crawl(self, account_context):
        dataset = _make_dataset()
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="website_crawl")),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch.object(DocumentService, "get_documents_position", return_value=1),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            with pytest.raises(ValueError, match="No website info list found"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    dataset_process_rule=SimpleNamespace(id="rule-1"),
                )
