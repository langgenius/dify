"""Unit tests for DatasetService and dataset-related collaborators."""

from .dataset_service_test_helpers import (
    CloudPlan,
    Dataset,
    DatasetCollectionBindingService,
    DatasetNameDuplicateError,
    DatasetPermissionEnum,
    DatasetPermissionService,
    DatasetProcessRule,
    DatasetService,
    DatasetServiceUnitDataFactory,
    DocumentIndexingError,
    DocumentService,
    LLMBadRequestError,
    MagicMock,
    Mock,
    ModelFeature,
    ModelType,
    NoPermissionError,
    NotFound,
    PipelineIconInfo,
    ProviderTokenNotInitError,
    RagPipelineDatasetCreateEntity,
    SimpleNamespace,
    TenantAccountRole,
    _make_knowledge_configuration,
    _make_retrieval_model,
    _make_session_context,
    json,
    patch,
    pytest,
)


class TestDatasetServiceQueries:
    """Unit tests for DatasetService query composition and fallback branches."""

    @pytest.fixture
    def mock_dataset_query_dependencies(self):
        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.helper.escape_like_pattern", return_value="escaped-search") as escape_like,
            patch("services.dataset_service.TagService.get_target_ids_by_tag_ids") as get_target_ids,
        ):
            mock_db.paginate.return_value = SimpleNamespace(items=["dataset"], total=1)
            yield {
                "db": mock_db,
                "escape_like_pattern": escape_like,
                "get_target_ids": get_target_ids,
            }

    def test_get_datasets_returns_paginated_results_for_public_view(self, mock_dataset_query_dependencies):
        items, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id="tenant-1")

        assert items == ["dataset"]
        assert total == 1
        mock_dataset_query_dependencies["db"].paginate.assert_called_once()
        mock_dataset_query_dependencies["escape_like_pattern"].assert_not_called()

    def test_get_datasets_short_circuits_for_dataset_operator_without_permissions(
        self, mock_dataset_query_dependencies
    ):
        user = DatasetServiceUnitDataFactory.create_user_mock(role=TenantAccountRole.DATASET_OPERATOR)
        mock_dataset_query_dependencies["db"].session.query.return_value.filter_by.return_value.all.return_value = []

        items, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id="tenant-1", user=user)

        assert items == []
        assert total == 0
        mock_dataset_query_dependencies["db"].paginate.assert_not_called()

    def test_get_datasets_short_circuits_when_tag_lookup_returns_no_target_ids(self, mock_dataset_query_dependencies):
        mock_dataset_query_dependencies["get_target_ids"].return_value = []

        items, total = DatasetService.get_datasets(
            page=1,
            per_page=20,
            tenant_id="tenant-1",
            tag_ids=["tag-1"],
        )

        assert items == []
        assert total == 0
        mock_dataset_query_dependencies["get_target_ids"].assert_called_once_with("knowledge", "tenant-1", ["tag-1"])
        mock_dataset_query_dependencies["db"].paginate.assert_not_called()

    def test_get_datasets_search_and_tag_filters_call_collaborators(self, mock_dataset_query_dependencies):
        mock_dataset_query_dependencies["get_target_ids"].return_value = ["dataset-1"]

        items, total = DatasetService.get_datasets(
            page=2,
            per_page=10,
            tenant_id="tenant-1",
            search="report",
            tag_ids=["tag-1"],
        )

        assert items == ["dataset"]
        assert total == 1
        mock_dataset_query_dependencies["escape_like_pattern"].assert_called_once_with("report")
        mock_dataset_query_dependencies["get_target_ids"].assert_called_once_with("knowledge", "tenant-1", ["tag-1"])
        mock_dataset_query_dependencies["db"].paginate.assert_called_once()

    def test_get_process_rules_returns_latest_rule_when_present(self):
        dataset_process_rule = Mock(spec=DatasetProcessRule)
        dataset_process_rule.mode = "automatic"
        dataset_process_rule.rules_dict = {"delimiter": "\n"}

        with patch("services.dataset_service.db") as mock_db:
            (
                mock_db.session.query.return_value.where.return_value.order_by.return_value.limit.return_value.one_or_none.return_value
            ) = dataset_process_rule

            result = DatasetService.get_process_rules("dataset-1")

        assert result == {"mode": "automatic", "rules": {"delimiter": "\n"}}

    def test_get_process_rules_falls_back_to_default_rules_when_missing(self):
        with patch("services.dataset_service.db") as mock_db:
            (
                mock_db.session.query.return_value.where.return_value.order_by.return_value.limit.return_value.one_or_none.return_value
            ) = None

            result = DatasetService.get_process_rules("dataset-1")

        assert result == {
            "mode": DocumentService.DEFAULT_RULES["mode"],
            "rules": DocumentService.DEFAULT_RULES["rules"],
        }

    def test_get_datasets_by_ids_returns_empty_for_missing_ids(self):
        with patch("services.dataset_service.db") as mock_db:
            items, total = DatasetService.get_datasets_by_ids([], "tenant-1")

        assert items == []
        assert total == 0
        mock_db.paginate.assert_not_called()

    def test_get_datasets_by_ids_uses_paginate_for_non_empty_input(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.paginate.return_value = SimpleNamespace(items=["dataset-1"], total=1)

            items, total = DatasetService.get_datasets_by_ids(["dataset-1"], "tenant-1")

        assert items == ["dataset-1"]
        assert total == 1
        mock_db.paginate.assert_called_once()

    def test_get_dataset_returns_first_match(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = dataset

            result = DatasetService.get_dataset(dataset.id)

        assert result is dataset


class TestDatasetServiceValidation:
    """Unit tests for DatasetService validation helpers."""

    @pytest.mark.parametrize(
        ("dataset_doc_form", "incoming_doc_form"),
        [(None, "text_model"), ("text_model", "text_model")],
    )
    def test_check_doc_form_allows_matching_or_missing_dataset_doc_form(self, dataset_doc_form, incoming_doc_form):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(doc_form=dataset_doc_form)

        DatasetService.check_doc_form(dataset, incoming_doc_form)

    def test_check_doc_form_rejects_mismatched_doc_form(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(doc_form="qa_model")

        with pytest.raises(ValueError, match="doc_form is different"):
            DatasetService.check_doc_form(dataset, "text_model")

    def test_check_dataset_model_setting_skips_non_high_quality_datasets(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(indexing_technique="economy")

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            DatasetService.check_dataset_model_setting(dataset)

        model_manager_cls.assert_not_called()

    def test_check_dataset_model_setting_validates_embedding_model_for_high_quality_dataset(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(indexing_technique="high_quality")

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            DatasetService.check_dataset_model_setting(dataset)

        model_manager_cls.for_tenant.return_value.get_model_instance.assert_called_once_with(
            tenant_id=dataset.tenant_id,
            provider=dataset.embedding_model_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=dataset.embedding_model,
        )

    def test_check_dataset_model_setting_wraps_llm_bad_request_error(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(indexing_technique="high_quality")

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = LLMBadRequestError()

            with pytest.raises(ValueError, match="No Embedding Model available"):
                DatasetService.check_dataset_model_setting(dataset)

    def test_check_dataset_model_setting_wraps_provider_token_error(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(indexing_technique="high_quality")

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = ProviderTokenNotInitError(
                "token missing"
            )

            with pytest.raises(ValueError, match="The dataset is unavailable, due to: token missing"):
                DatasetService.check_dataset_model_setting(dataset)

    def test_check_embedding_model_setting_wraps_provider_token_error_description(self):
        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = ProviderTokenNotInitError(
                "provider setup"
            )

            with pytest.raises(ValueError, match="provider setup"):
                DatasetService.check_embedding_model_setting("tenant-1", "provider", "embedding-model")

    def test_check_reranking_model_setting_uses_rerank_model_type(self):
        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            DatasetService.check_reranking_model_setting("tenant-1", "provider", "reranker")

        model_manager_cls.for_tenant.return_value.get_model_instance.assert_called_once_with(
            tenant_id="tenant-1",
            provider="provider",
            model_type=ModelType.RERANK,
            model="reranker",
        )

    def test_check_reranking_model_setting_wraps_bad_request(self):
        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = LLMBadRequestError()

            with pytest.raises(ValueError, match="No Rerank Model available"):
                DatasetService.check_reranking_model_setting("tenant-1", "provider", "reranker")

    def test_check_is_multimodal_model_returns_true_when_model_supports_vision(self):
        model_schema = SimpleNamespace(features=[ModelFeature.VISION])
        model_type_instance = MagicMock()
        model_type_instance.get_model_schema.return_value = model_schema
        model_instance = SimpleNamespace(
            model_type_instance=model_type_instance,
            model_name="embedding-model",
            credentials={"api_key": "secret"},
        )

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = model_instance

            result = DatasetService.check_is_multimodal_model("tenant-1", "provider", "embedding-model")

        assert result is True

    def test_check_is_multimodal_model_returns_false_when_vision_feature_is_absent(self):
        model_schema = SimpleNamespace(features=[])
        model_type_instance = MagicMock()
        model_type_instance.get_model_schema.return_value = model_schema
        model_instance = SimpleNamespace(
            model_type_instance=model_type_instance,
            model_name="embedding-model",
            credentials={"api_key": "secret"},
        )

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = model_instance

            result = DatasetService.check_is_multimodal_model("tenant-1", "provider", "embedding-model")

        assert result is False

    def test_check_is_multimodal_model_raises_when_schema_is_missing(self):
        model_type_instance = MagicMock()
        model_type_instance.get_model_schema.return_value = None
        model_instance = SimpleNamespace(
            model_type_instance=model_type_instance,
            model_name="embedding-model",
            credentials={"api_key": "secret"},
        )

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = model_instance

            with pytest.raises(ValueError, match="Model schema not found"):
                DatasetService.check_is_multimodal_model("tenant-1", "provider", "embedding-model")

    def test_check_is_multimodal_model_wraps_bad_request_error(self):
        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = LLMBadRequestError()

            with pytest.raises(ValueError, match="No Model available"):
                DatasetService.check_is_multimodal_model("tenant-1", "provider", "embedding-model")


class TestDatasetServiceCreationAndUpdate:
    """Unit tests for dataset creation and update helpers."""

    def test_create_empty_dataset_raises_when_name_already_exists(self):
        account = SimpleNamespace(id="user-1")

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = object()

            with pytest.raises(DatasetNameDuplicateError, match="Dataset with name Dataset already exists"):
                DatasetService.create_empty_dataset("tenant-1", "Dataset", None, "economy", account)

    def test_create_empty_dataset_uses_default_embedding_model_for_high_quality_dataset(self):
        account = SimpleNamespace(id="user-1")
        default_embedding_model = SimpleNamespace(provider="provider", model_name="default-embedding")

        with (
            patch("services.dataset_service.db") as mock_db,
            patch(
                "services.dataset_service.Dataset",
                side_effect=lambda **kwargs: SimpleNamespace(id="dataset-1", **kwargs),
            ),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch.object(DatasetService, "check_embedding_model_setting") as check_embedding,
        ):
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = None
            model_manager_cls.for_tenant.return_value.get_default_model_instance.return_value = default_embedding_model

            dataset = DatasetService.create_empty_dataset(
                tenant_id="tenant-1",
                name="Dataset",
                description="Description",
                indexing_technique="high_quality",
                account=account,
            )

        assert dataset.embedding_model_provider == "provider"
        assert dataset.embedding_model == "default-embedding"
        assert dataset.permission == DatasetPermissionEnum.ONLY_ME
        assert dataset.provider == "vendor"
        model_manager_cls.for_tenant.return_value.get_default_model_instance.assert_called_once_with(
            tenant_id="tenant-1",
            model_type=ModelType.TEXT_EMBEDDING,
        )
        check_embedding.assert_not_called()
        mock_db.session.commit.assert_called_once()

    def test_create_empty_dataset_creates_external_binding_for_high_quality_dataset(self):
        account = SimpleNamespace(id="user-1")
        retrieval_model = _make_retrieval_model()
        embedding_model = SimpleNamespace(provider="provider", model_name="embedding-model")

        with (
            patch("services.dataset_service.db") as mock_db,
            patch(
                "services.dataset_service.Dataset",
                side_effect=lambda **kwargs: SimpleNamespace(id="dataset-1", **kwargs),
            ),
            patch(
                "services.dataset_service.ExternalKnowledgeBindings",
                side_effect=lambda **kwargs: SimpleNamespace(**kwargs),
            ) as binding_cls,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.ExternalDatasetService.get_external_knowledge_api", return_value=object()),
            patch.object(DatasetService, "check_embedding_model_setting") as check_embedding,
            patch.object(DatasetService, "check_reranking_model_setting") as check_reranking,
        ):
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = None
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model

            dataset = DatasetService.create_empty_dataset(
                tenant_id="tenant-1",
                name="External Dataset",
                description="Description",
                indexing_technique="high_quality",
                account=account,
                permission=DatasetPermissionEnum.ALL_TEAM,
                provider="external",
                external_knowledge_api_id="api-1",
                external_knowledge_id="knowledge-1",
                embedding_model_provider="provider",
                embedding_model_name="embedding-model",
                retrieval_model=retrieval_model,
                summary_index_setting={"enable": True},
            )

        assert dataset.embedding_model_provider == "provider"
        assert dataset.embedding_model == "embedding-model"
        assert dataset.retrieval_model == retrieval_model.model_dump()
        assert dataset.summary_index_setting == {"enable": True}
        check_embedding.assert_called_once_with("tenant-1", "provider", "embedding-model")
        check_reranking.assert_called_once_with("tenant-1", "rerank-provider", "rerank-model")
        binding_cls.assert_called_once_with(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            external_knowledge_api_id="api-1",
            external_knowledge_id="knowledge-1",
            created_by="user-1",
        )
        assert mock_db.session.add.call_count == 2
        mock_db.session.commit.assert_called_once()

    def test_create_empty_rag_pipeline_dataset_raises_for_duplicate_name(self):
        entity = RagPipelineDatasetCreateEntity(
            name="Existing Dataset",
            description="Description",
            icon_info=PipelineIconInfo(icon="book", icon_background="#fff"),
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = object()

            with pytest.raises(DatasetNameDuplicateError, match="Existing Dataset already exists"):
                DatasetService.create_empty_rag_pipeline_dataset("tenant-1", entity)

    def test_create_empty_rag_pipeline_dataset_generates_name_and_creates_dataset(self):
        entity = RagPipelineDatasetCreateEntity(
            name="",
            description="Description",
            icon_info=PipelineIconInfo(icon="book", icon_background="#fff"),
            permission=DatasetPermissionEnum.ALL_TEAM,
        )
        pipeline = SimpleNamespace(id="pipeline-1")

        def pipeline_factory(**kwargs):
            pipeline.__dict__.update(kwargs)
            return pipeline

        def dataset_factory(**kwargs):
            return SimpleNamespace(id="dataset-1", **kwargs)

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.current_user", SimpleNamespace(id="user-1")),
            patch("services.dataset_service.generate_incremental_name", return_value="Untitled 2") as generate_name,
            patch("services.dataset_service.Pipeline", side_effect=pipeline_factory),
            patch("services.dataset_service.Dataset", side_effect=dataset_factory),
        ):
            mock_db.session.query.return_value.filter_by.return_value.all.return_value = [
                SimpleNamespace(name="Untitled"),
                SimpleNamespace(name="Untitled 1"),
            ]

            dataset = DatasetService.create_empty_rag_pipeline_dataset("tenant-1", entity)

        assert entity.name == "Untitled 2"
        assert dataset.pipeline_id == "pipeline-1"
        assert dataset.runtime_mode == "rag_pipeline"
        generate_name.assert_called_once_with(["Untitled", "Untitled 1"], "Untitled")
        mock_db.session.commit.assert_called_once()

    def test_create_empty_rag_pipeline_dataset_requires_current_user_id(self):
        entity = RagPipelineDatasetCreateEntity(
            name="Dataset",
            description="Description",
            icon_info=PipelineIconInfo(icon="book", icon_background="#fff"),
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.current_user", SimpleNamespace(id=None)),
        ):
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

            with pytest.raises(ValueError, match="Current user or current user id not found"):
                DatasetService.create_empty_rag_pipeline_dataset("tenant-1", entity)

    def test_update_dataset_raises_when_dataset_is_missing(self):
        with patch.object(DatasetService, "get_dataset", return_value=None):
            with pytest.raises(ValueError, match="Dataset not found"):
                DatasetService.update_dataset("dataset-1", {}, SimpleNamespace(id="user-1"))

    def test_update_dataset_raises_when_new_name_conflicts(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1", tenant_id="tenant-1")
        dataset.name = "Old Dataset"

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "_has_dataset_same_name", return_value=True),
        ):
            with pytest.raises(ValueError, match="Dataset name already exists"):
                DatasetService.update_dataset("dataset-1", {"name": "New Dataset"}, SimpleNamespace(id="user-1"))

    def test_update_dataset_routes_external_datasets_to_external_helper(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1", tenant_id="tenant-1")
        dataset.provider = "external"
        user = DatasetServiceUnitDataFactory.create_user_mock()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission") as check_permission,
            patch.object(DatasetService, "_update_external_dataset", return_value="updated") as update_external,
        ):
            result = DatasetService.update_dataset("dataset-1", {"name": dataset.name}, user)

        assert result == "updated"
        check_permission.assert_called_once_with(dataset, user)
        update_external.assert_called_once_with(dataset, {"name": dataset.name}, user)

    def test_update_dataset_routes_internal_datasets_to_internal_helper(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1", tenant_id="tenant-1")
        dataset.provider = "vendor"
        user = DatasetServiceUnitDataFactory.create_user_mock()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission") as check_permission,
            patch.object(DatasetService, "_update_internal_dataset", return_value="updated") as update_internal,
        ):
            result = DatasetService.update_dataset("dataset-1", {"name": dataset.name}, user)

        assert result == "updated"
        check_permission.assert_called_once_with(dataset, user)
        update_internal.assert_called_once_with(dataset, {"name": dataset.name}, user)

    def test_has_dataset_same_name_returns_true_when_query_matches(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.first.return_value = object()

            result = DatasetService._has_dataset_same_name("tenant-1", "dataset-1", "Dataset")

        assert result is True

    def test_update_external_dataset_updates_dataset_and_binding(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        user = SimpleNamespace(id="user-1")
        now = object()

        with (
            patch.object(DatasetService, "_update_external_knowledge_binding") as update_binding,
            patch("services.dataset_service.naive_utc_now", return_value=now),
            patch("services.dataset_service.db") as mock_db,
        ):
            result = DatasetService._update_external_dataset(
                dataset,
                {
                    "external_retrieval_model": {"top_k": 3},
                    "summary_index_setting": {"enable": True},
                    "name": "Updated Dataset",
                    "description": "Updated description",
                    "permission": DatasetPermissionEnum.PARTIAL_TEAM,
                    "external_knowledge_id": "knowledge-1",
                    "external_knowledge_api_id": "api-1",
                },
                user,
            )

        assert result is dataset
        assert dataset.retrieval_model == {"top_k": 3}
        assert dataset.summary_index_setting == {"enable": True}
        assert dataset.name == "Updated Dataset"
        assert dataset.description == "Updated description"
        assert dataset.permission == DatasetPermissionEnum.PARTIAL_TEAM
        assert dataset.updated_by == "user-1"
        assert dataset.updated_at is now
        update_binding.assert_called_once_with("dataset-1", "knowledge-1", "api-1")
        mock_db.session.add.assert_called_once_with(dataset)
        mock_db.session.commit.assert_called_once()

    @pytest.mark.parametrize(
        ("payload", "message"),
        [
            ({"external_knowledge_api_id": "api-1"}, "External knowledge id is required"),
            ({"external_knowledge_id": "knowledge-1"}, "External knowledge api id is required"),
        ],
    )
    def test_update_external_dataset_requires_external_binding_fields(self, payload, message):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")

        with pytest.raises(ValueError, match=message):
            DatasetService._update_external_dataset(dataset, payload, SimpleNamespace(id="user-1"))

    def test_update_external_knowledge_binding_updates_changed_binding_values(self):
        binding = SimpleNamespace(external_knowledge_id="old-knowledge", external_knowledge_api_id="old-api")
        session = MagicMock()
        session.query.return_value.filter_by.return_value.first.return_value = binding
        session_context = _make_session_context(session)

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.Session", return_value=session_context),
        ):
            DatasetService._update_external_knowledge_binding("dataset-1", "new-knowledge", "new-api")

        assert binding.external_knowledge_id == "new-knowledge"
        assert binding.external_knowledge_api_id == "new-api"
        mock_db.session.add.assert_called_once_with(binding)

    def test_update_external_knowledge_binding_raises_for_missing_binding(self):
        session = MagicMock()
        session.query.return_value.filter_by.return_value.first.return_value = None
        session_context = _make_session_context(session)

        with (
            patch("services.dataset_service.db"),
            patch("services.dataset_service.Session", return_value=session_context),
        ):
            with pytest.raises(ValueError, match="External knowledge binding not found"):
                DatasetService._update_external_knowledge_binding("dataset-1", "knowledge-1", "api-1")

    def test_update_internal_dataset_updates_fields_and_dispatches_regeneration_tasks(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        user = SimpleNamespace(id="user-1")
        now = object()
        update_payload = {
            "name": "Updated Dataset",
            "description": None,
            "partial_member_list": [{"user_id": "member-1"}],
            "external_knowledge_api_id": "api-1",
            "external_knowledge_id": "knowledge-1",
            "external_retrieval_model": {"top_k": 2},
            "retrieval_model": {"top_k": 4},
            "summary_index_setting": {"enable": True},
            "icon_info": {"icon": "book"},
        }

        with (
            patch.object(DatasetService, "_handle_indexing_technique_change", return_value="update"),
            patch.object(DatasetService, "_update_pipeline_knowledge_base_node_data") as update_pipeline,
            patch("services.dataset_service.naive_utc_now", return_value=now),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.deal_dataset_vector_index_task") as vector_task,
            patch("services.dataset_service.regenerate_summary_index_task") as regenerate_task,
        ):
            result = DatasetService._update_internal_dataset(dataset, update_payload.copy(), user)

        assert result is dataset
        updated_values = mock_db.session.query.return_value.filter_by.return_value.update.call_args.args[0]
        assert updated_values["name"] == "Updated Dataset"
        assert updated_values["description"] is None
        assert updated_values["retrieval_model"] == {"top_k": 4}
        assert updated_values["summary_index_setting"] == {"enable": True}
        assert updated_values["icon_info"] == {"icon": "book"}
        assert updated_values["updated_by"] == "user-1"
        assert updated_values["updated_at"] is now
        assert "partial_member_list" not in updated_values
        assert "external_knowledge_api_id" not in updated_values
        assert "external_knowledge_id" not in updated_values
        assert "external_retrieval_model" not in updated_values
        mock_db.session.commit.assert_called_once()
        mock_db.session.refresh.assert_called_once_with(dataset)
        update_pipeline.assert_called_once_with(dataset, "user-1")
        vector_task.delay.assert_called_once_with("dataset-1", "update")
        regenerate_task.delay.assert_called_once_with(
            "dataset-1",
            regenerate_reason="embedding_model_changed",
            regenerate_vectors_only=True,
        )

    def test_update_pipeline_knowledge_base_node_data_returns_early_for_non_pipeline_dataset(self):
        dataset = SimpleNamespace(runtime_mode="workflow", pipeline_id="pipeline-1")

        with patch("services.dataset_service.db") as mock_db:
            DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-1")

        mock_db.session.query.assert_not_called()

    def test_update_pipeline_knowledge_base_node_data_returns_when_pipeline_is_missing(self):
        dataset = SimpleNamespace(runtime_mode="rag_pipeline", pipeline_id="pipeline-1")

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

            DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-1")

        mock_db.session.commit.assert_not_called()

    def test_update_pipeline_knowledge_base_node_data_updates_published_and_draft_workflows(self):
        dataset = SimpleNamespace(
            id="dataset-1",
            runtime_mode="rag_pipeline",
            pipeline_id="pipeline-1",
            embedding_model="embedding-model",
            embedding_model_provider="provider",
            retrieval_model={"top_k": 5},
            chunk_structure="paragraph",
            indexing_technique="high_quality",
            keyword_number=8,
            summary_index_setting={"enable": True},
        )
        pipeline = SimpleNamespace(id="pipeline-1", tenant_id="tenant-1")
        published_workflow = SimpleNamespace(
            graph=json.dumps({"nodes": [{"data": {"type": "knowledge-index"}}, {"data": {"type": "start"}}]}),
            type="chat",
            features={"feature": True},
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        draft_workflow = SimpleNamespace(graph=json.dumps({"nodes": [{"data": {"type": "knowledge-index"}}]}))
        new_workflow = SimpleNamespace(id="workflow-1")
        rag_pipeline_service = MagicMock()
        rag_pipeline_service.get_published_workflow.return_value = published_workflow
        rag_pipeline_service.get_draft_workflow.return_value = draft_workflow

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.RagPipelineService", return_value=rag_pipeline_service),
            patch("services.dataset_service.Workflow.new", return_value=new_workflow) as workflow_new,
        ):
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = pipeline

            DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-1")

        published_graph = json.loads(workflow_new.call_args.kwargs["graph"])
        assert published_graph["nodes"][0]["data"]["embedding_model"] == "embedding-model"
        assert published_graph["nodes"][0]["data"]["summary_index_setting"] == {"enable": True}
        assert json.loads(draft_workflow.graph)["nodes"][0]["data"]["embedding_model_provider"] == "provider"
        mock_db.session.add.assert_any_call(new_workflow)
        mock_db.session.add.assert_any_call(draft_workflow)
        mock_db.session.commit.assert_called_once()

    def test_update_pipeline_knowledge_base_node_data_rolls_back_when_update_fails(self):
        dataset = SimpleNamespace(runtime_mode="rag_pipeline", pipeline_id="pipeline-1")
        pipeline = SimpleNamespace(id="pipeline-1", tenant_id="tenant-1")
        rag_pipeline_service = MagicMock()
        rag_pipeline_service.get_published_workflow.side_effect = RuntimeError("boom")

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.RagPipelineService", return_value=rag_pipeline_service),
        ):
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = pipeline

            with pytest.raises(RuntimeError, match="boom"):
                DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-1")

        mock_db.session.rollback.assert_called_once()

    def test_handle_indexing_technique_change_returns_none_without_indexing_technique(self):
        filtered_data: dict[str, object] = {}
        dataset = SimpleNamespace(indexing_technique="economy")

        result = DatasetService._handle_indexing_technique_change(dataset, {}, filtered_data)

        assert result is None
        assert filtered_data == {}

    def test_handle_indexing_technique_change_switches_to_economy(self):
        filtered_data: dict[str, object] = {}
        dataset = SimpleNamespace(indexing_technique="high_quality")

        result = DatasetService._handle_indexing_technique_change(
            dataset,
            {"indexing_technique": "economy"},
            filtered_data,
        )

        assert result == "remove"
        assert filtered_data == {
            "embedding_model": None,
            "embedding_model_provider": None,
            "collection_binding_id": None,
        }

    def test_handle_indexing_technique_change_switches_to_high_quality(self):
        filtered_data: dict[str, object] = {}
        dataset = SimpleNamespace(indexing_technique="economy")

        with patch.object(DatasetService, "_configure_embedding_model_for_high_quality") as configure_embedding:
            result = DatasetService._handle_indexing_technique_change(
                dataset,
                {"indexing_technique": "high_quality"},
                filtered_data,
            )

        assert result == "add"
        configure_embedding.assert_called_once_with({"indexing_technique": "high_quality"}, filtered_data)

    def test_handle_indexing_technique_change_delegates_when_technique_is_unchanged(self):
        filtered_data: dict[str, object] = {}
        dataset = SimpleNamespace(indexing_technique="high_quality")

        with patch.object(
            DatasetService,
            "_handle_embedding_model_update_when_technique_unchanged",
            return_value="update",
        ) as update_embedding:
            result = DatasetService._handle_indexing_technique_change(
                dataset,
                {"indexing_technique": "high_quality"},
                filtered_data,
            )

        assert result == "update"
        update_embedding.assert_called_once_with(dataset, {"indexing_technique": "high_quality"}, filtered_data)

    def test_configure_embedding_model_for_high_quality_updates_filtered_data(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"
        embedding_model = SimpleNamespace(provider="provider", model_name="embedding-model")
        filtered_data: dict[str, object] = {}

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-1"),
            ),
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model

            DatasetService._configure_embedding_model_for_high_quality(
                {"embedding_model_provider": "provider", "embedding_model": "embedding-model"},
                filtered_data,
            )

        assert filtered_data == {
            "embedding_model": "embedding-model",
            "embedding_model_provider": "provider",
            "collection_binding_id": "binding-1",
        }

    @pytest.mark.parametrize(
        ("error", "message"),
        [
            (LLMBadRequestError(), "No Embedding Model available"),
            (ProviderTokenNotInitError("provider setup"), "provider setup"),
        ],
    )
    def test_configure_embedding_model_for_high_quality_wraps_model_errors(self, error, message):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = error

            with pytest.raises(ValueError, match=message):
                DatasetService._configure_embedding_model_for_high_quality(
                    {"embedding_model_provider": "provider", "embedding_model": "embedding-model"},
                    {},
                )

    def test_handle_embedding_model_update_when_technique_unchanged_preserves_existing_settings(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
        )
        filtered_data: dict[str, object] = {}

        with patch.object(DatasetService, "_preserve_existing_embedding_settings") as preserve_settings:
            result = DatasetService._handle_embedding_model_update_when_technique_unchanged(
                dataset,
                {},
                filtered_data,
            )

        assert result is None
        preserve_settings.assert_called_once_with(dataset, filtered_data)

    def test_handle_embedding_model_update_when_technique_unchanged_updates_when_model_is_provided(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
        )

        with patch.object(DatasetService, "_update_embedding_model_settings", return_value="update") as update_settings:
            result = DatasetService._handle_embedding_model_update_when_technique_unchanged(
                dataset,
                {"embedding_model_provider": "provider-two", "embedding_model": "embedding-model-two"},
                {},
            )

        assert result == "update"
        update_settings.assert_called_once()

    def test_preserve_existing_embedding_settings_keeps_current_binding(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
            collection_binding_id="binding-1",
        )
        filtered_data = {"embedding_model_provider": "", "embedding_model": ""}

        DatasetService._preserve_existing_embedding_settings(dataset, filtered_data)

        assert filtered_data == {
            "embedding_model_provider": "provider",
            "embedding_model": "embedding-model",
            "collection_binding_id": "binding-1",
        }

    def test_preserve_existing_embedding_settings_removes_empty_placeholders_without_existing_values(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider=None,
            embedding_model=None,
            collection_binding_id=None,
        )
        filtered_data = {"embedding_model_provider": "", "embedding_model": ""}

        DatasetService._preserve_existing_embedding_settings(dataset, filtered_data)

        assert filtered_data == {}

    def test_update_embedding_model_settings_returns_update_for_changed_values(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
        )

        with patch.object(DatasetService, "_apply_new_embedding_settings") as apply_settings:
            result = DatasetService._update_embedding_model_settings(
                dataset,
                {"embedding_model_provider": "provider-two", "embedding_model": "embedding-model-two"},
                {},
            )

        assert result == "update"
        apply_settings.assert_called_once()

    def test_update_embedding_model_settings_returns_none_for_unchanged_values(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
        )

        result = DatasetService._update_embedding_model_settings(
            dataset,
            {"embedding_model_provider": "provider", "embedding_model": "embedding-model"},
            {},
        )

        assert result is None

    def test_update_embedding_model_settings_wraps_bad_request_errors(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
        )

        with patch.object(DatasetService, "_apply_new_embedding_settings", side_effect=LLMBadRequestError()):
            with pytest.raises(ValueError, match="No Embedding Model available"):
                DatasetService._update_embedding_model_settings(
                    dataset,
                    {"embedding_model_provider": "provider-two", "embedding_model": "embedding-model-two"},
                    {},
                )

    def test_apply_new_embedding_settings_updates_binding_for_new_model(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(collection_binding_id="binding-1")
        filtered_data: dict[str, object] = {}

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-2"),
            ),
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = SimpleNamespace(
                provider="provider-two",
                model_name="embedding-model-two",
            )

            DatasetService._apply_new_embedding_settings(
                dataset,
                {"embedding_model_provider": "provider-two", "embedding_model": "embedding-model-two"},
                filtered_data,
            )

        assert filtered_data == {
            "embedding_model": "embedding-model-two",
            "embedding_model_provider": "provider-two",
            "collection_binding_id": "binding-2",
        }

    def test_apply_new_embedding_settings_preserves_existing_values_when_provider_token_is_missing(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
            collection_binding_id="binding-1",
        )
        filtered_data: dict[str, object] = {}

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = ProviderTokenNotInitError(
                "token missing"
            )

            DatasetService._apply_new_embedding_settings(
                dataset,
                {"embedding_model_provider": "provider-two", "embedding_model": "embedding-model-two"},
                filtered_data,
            )

        assert filtered_data == {
            "embedding_model_provider": "provider",
            "embedding_model": "embedding-model",
            "collection_binding_id": "binding-1",
        }

    @pytest.mark.parametrize(
        ("summary_index_setting", "expected"),
        [
            (None, False),
            ({"enable": False}, False),
            ({"enable": True, "model_name": "old-model", "model_provider_name": "provider"}, False),
            ({"enable": True, "model_name": "new-model", "model_provider_name": "provider-two"}, True),
        ],
    )
    def test_check_summary_index_setting_model_changed(self, summary_index_setting, expected):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            dataset_id="dataset-1",
            summary_index_setting={"enable": True, "model_name": "old-model", "model_provider_name": "provider"},
        )

        result = DatasetService._check_summary_index_setting_model_changed(
            dataset,
            {"summary_index_setting": summary_index_setting} if summary_index_setting is not None else {},
        )

        assert result is expected


class TestDatasetServiceRagPipelineSettings:
    """Unit tests for rag-pipeline dataset setting updates."""

    def test_update_rag_pipeline_dataset_settings_requires_current_tenant(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        knowledge_configuration = _make_knowledge_configuration()

        with patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id=None)):
            with pytest.raises(ValueError, match="Current user or current tenant not found"):
                DatasetService.update_rag_pipeline_dataset_settings(session, dataset, knowledge_configuration)

    def test_update_rag_pipeline_dataset_settings_without_published_high_quality_updates_embedding_settings(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(summary_index_setting={"enable": True})
        embedding_model = SimpleNamespace(provider="provider", model_name="embedding-model")

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch.object(DatasetService, "check_is_multimodal_model", return_value=True) as check_multimodal,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-1"),
            ),
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model

            DatasetService.update_rag_pipeline_dataset_settings(session, dataset, knowledge_configuration)

        assert dataset.chunk_structure == "paragraph"
        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == "embedding-model"
        assert dataset.embedding_model_provider == "provider"
        assert dataset.collection_binding_id == "binding-1"
        assert dataset.is_multimodal is True
        assert dataset.retrieval_model == knowledge_configuration.retrieval_model.model_dump()
        assert dataset.summary_index_setting == {"enable": True}
        check_multimodal.assert_called_once_with("tenant-1", "provider", "embedding-model")
        session.add.assert_called_once_with(dataset)
        session.commit.assert_not_called()

    def test_update_rag_pipeline_dataset_settings_without_published_economy_updates_keyword_number(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(
            indexing_technique="economy",
            embedding_model_provider="",
            embedding_model="",
            keyword_number=12,
        )

        with patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")):
            DatasetService.update_rag_pipeline_dataset_settings(session, dataset, knowledge_configuration)

        assert dataset.indexing_technique == "economy"
        assert dataset.keyword_number == 12
        assert dataset.retrieval_model == knowledge_configuration.retrieval_model.model_dump()
        session.add.assert_called_once_with(dataset)

    def test_update_rag_pipeline_dataset_settings_with_published_rejects_chunk_structure_changes(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(chunk_structure="sentence")

        with patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")):
            with pytest.raises(ValueError, match="Chunk structure is not allowed to be updated"):
                DatasetService.update_rag_pipeline_dataset_settings(
                    session,
                    dataset,
                    knowledge_configuration,
                    has_published=True,
                )

    def test_update_rag_pipeline_dataset_settings_with_published_rejects_switch_to_economy(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        dataset.indexing_technique = "high_quality"
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(
            indexing_technique="economy",
            embedding_model_provider="",
            embedding_model="",
        )

        with patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")):
            with pytest.raises(
                ValueError,
                match="Knowledge base indexing technique is not allowed to be updated to economy",
            ):
                DatasetService.update_rag_pipeline_dataset_settings(
                    session,
                    dataset,
                    knowledge_configuration,
                    has_published=True,
                )

    def test_update_rag_pipeline_dataset_settings_with_published_adds_high_quality_index(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        dataset.indexing_technique = "economy"
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration()
        embedding_model = SimpleNamespace(provider="provider", model_name="embedding-model")

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch.object(DatasetService, "check_is_multimodal_model", return_value=False),
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-1"),
            ),
            patch("services.dataset_service.deal_dataset_index_update_task") as update_task,
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model

            DatasetService.update_rag_pipeline_dataset_settings(
                session,
                dataset,
                knowledge_configuration,
                has_published=True,
            )

        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == "embedding-model"
        assert dataset.embedding_model_provider == "provider"
        assert dataset.collection_binding_id == "binding-1"
        assert dataset.is_multimodal is False
        assert dataset.retrieval_model == knowledge_configuration.retrieval_model.model_dump()
        session.add.assert_called_once_with(dataset)
        session.commit.assert_called_once()
        update_task.delay.assert_called_once_with("dataset-1", "add")

    def test_update_rag_pipeline_dataset_settings_with_published_updates_changed_embedding_model(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider"
        dataset.embedding_model = "embedding-model"
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(
            embedding_model_provider="provider-two",
            embedding_model="embedding-model-two",
            summary_index_setting={"enable": True},
        )

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch.object(DatasetService, "check_is_multimodal_model", return_value=True),
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-2"),
            ),
            patch("services.dataset_service.deal_dataset_index_update_task") as update_task,
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = SimpleNamespace(
                provider="provider-two",
                model_name="embedding-model-two",
            )

            DatasetService.update_rag_pipeline_dataset_settings(
                session,
                dataset,
                knowledge_configuration,
                has_published=True,
            )

        assert dataset.embedding_model_provider == "provider-two"
        assert dataset.embedding_model == "embedding-model-two"
        assert dataset.collection_binding_id == "binding-2"
        assert dataset.is_multimodal is True
        assert dataset.summary_index_setting == {"enable": True}
        session.add.assert_called_once_with(dataset)
        session.commit.assert_called_once()
        update_task.delay.assert_called_once_with("dataset-1", "update")

    def test_update_rag_pipeline_dataset_settings_with_published_skips_embedding_update_when_token_is_missing(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider"
        dataset.embedding_model = "embedding-model"
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(
            embedding_model_provider="provider-two",
            embedding_model="embedding-model-two",
        )

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.deal_dataset_index_update_task") as update_task,
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = ProviderTokenNotInitError(
                "token missing"
            )

            DatasetService.update_rag_pipeline_dataset_settings(
                session,
                dataset,
                knowledge_configuration,
                has_published=True,
            )

        assert dataset.embedding_model_provider == "provider"
        assert dataset.embedding_model == "embedding-model"
        assert dataset.retrieval_model == knowledge_configuration.retrieval_model.model_dump()
        session.add.assert_called_once_with(dataset)
        session.commit.assert_called_once()
        update_task.delay.assert_called_once_with("dataset-1", "update")

    def test_update_rag_pipeline_dataset_settings_with_published_updates_economy_keyword_number(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        dataset.indexing_technique = "economy"
        dataset.keyword_number = 5
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(
            indexing_technique="economy",
            embedding_model_provider="",
            embedding_model="",
            keyword_number=9,
        )

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")),
            patch("services.dataset_service.deal_dataset_index_update_task") as update_task,
        ):
            DatasetService.update_rag_pipeline_dataset_settings(
                session,
                dataset,
                knowledge_configuration,
                has_published=True,
            )

        assert dataset.keyword_number == 9
        assert dataset.retrieval_model == knowledge_configuration.retrieval_model.model_dump()
        session.add.assert_called_once_with(dataset)
        session.commit.assert_called_once()
        update_task.delay.assert_not_called()


class TestDatasetServicePermissionsAndLifecycle:
    """Unit tests for dataset permissions, deletion, and metadata helpers."""

    def test_delete_dataset_returns_false_when_dataset_is_missing(self):
        with patch.object(DatasetService, "get_dataset", return_value=None):
            result = DatasetService.delete_dataset("dataset-1", user=SimpleNamespace(id="user-1"))

        assert result is False

    def test_delete_dataset_checks_permission_and_deletes_dataset(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission") as check_permission,
            patch("services.dataset_service.dataset_was_deleted.send") as send_deleted_signal,
            patch("services.dataset_service.db") as mock_db,
        ):
            result = DatasetService.delete_dataset(dataset.id, user=SimpleNamespace(id="user-1"))

        assert result is True
        check_permission.assert_called_once_with(dataset, SimpleNamespace(id="user-1"))
        send_deleted_signal.assert_called_once_with(dataset)
        mock_db.session.delete.assert_called_once_with(dataset)
        mock_db.session.commit.assert_called_once()

    def test_dataset_use_check_returns_scalar_result(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.execute.return_value.scalar_one.return_value = True

            result = DatasetService.dataset_use_check("dataset-1")

        assert result is True

    def test_check_dataset_permission_rejects_cross_tenant_access(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(tenant_id="tenant-a")
        user = DatasetServiceUnitDataFactory.create_user_mock(tenant_id="tenant-b")

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_rejects_only_me_dataset_for_non_creator(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="owner-1",
        )
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="member-1",
            role=TenantAccountRole.EDITOR,
        )

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_rejects_partial_team_user_without_binding(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="owner-1",
        )
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="member-1",
            role=TenantAccountRole.EDITOR,
        )

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

            with pytest.raises(NoPermissionError, match="do not have permission"):
                DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_allows_partial_team_creator_without_lookup(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="creator-1",
        )
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="creator-1",
            role=TenantAccountRole.EDITOR,
        )

        with patch("services.dataset_service.db") as mock_db:
            DatasetService.check_dataset_permission(dataset, user)

        mock_db.session.query.assert_not_called()

    def test_check_dataset_permission_allows_partial_team_member_with_binding(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="owner-1",
        )
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="member-1",
            role=TenantAccountRole.EDITOR,
        )

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = object()

            DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_operator_permission_validates_required_arguments(self):
        with pytest.raises(ValueError, match="Dataset not found"):
            DatasetService.check_dataset_operator_permission(user=SimpleNamespace(id="user-1"), dataset=None)

        with pytest.raises(ValueError, match="User not found"):
            DatasetService.check_dataset_operator_permission(user=None, dataset=SimpleNamespace(id="dataset-1"))

    def test_check_dataset_operator_permission_rejects_only_me_for_non_creator(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="owner-1",
        )
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="member-1",
            role=TenantAccountRole.EDITOR,
        )

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

    def test_check_dataset_operator_permission_rejects_partial_team_without_binding(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.PARTIAL_TEAM)
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="member-1",
            role=TenantAccountRole.EDITOR,
        )

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.all.return_value = []

            with pytest.raises(NoPermissionError, match="do not have permission"):
                DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

    def test_get_dataset_queries_delegates_to_paginate(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.desc.side_effect = lambda column: column
            mock_db.paginate.return_value = SimpleNamespace(items=["query"], total=1)

            items, total = DatasetService.get_dataset_queries("dataset-1", page=1, per_page=20)

        assert items == ["query"]
        assert total == 1
        mock_db.paginate.assert_called_once()

    def test_get_related_apps_returns_ordered_query_results(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.desc.side_effect = lambda column: column
            mock_db.session.query.return_value.where.return_value.order_by.return_value.all.return_value = [
                "relation-1"
            ]

            result = DatasetService.get_related_apps("dataset-1")

        assert result == ["relation-1"]

    def test_update_dataset_api_status_raises_not_found_for_missing_dataset(self):
        with patch.object(DatasetService, "get_dataset", return_value=None):
            with pytest.raises(NotFound, match="Dataset not found"):
                DatasetService.update_dataset_api_status("dataset-1", True)

    def test_update_dataset_api_status_requires_current_user_id(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(enable_api=False)

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch("services.dataset_service.current_user", SimpleNamespace(id=None)),
        ):
            with pytest.raises(ValueError, match="Current user or current user id not found"):
                DatasetService.update_dataset_api_status(dataset.id, True)

    def test_update_dataset_api_status_updates_fields_and_commits(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(enable_api=False)
        now = object()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch("services.dataset_service.current_user", SimpleNamespace(id="user-1")),
            patch("services.dataset_service.naive_utc_now", return_value=now),
            patch("services.dataset_service.db") as mock_db,
        ):
            DatasetService.update_dataset_api_status(dataset.id, True)

        assert dataset.enable_api is True
        assert dataset.updated_by == "user-1"
        assert dataset.updated_at is now
        mock_db.session.commit.assert_called_once()

    def test_get_dataset_auto_disable_logs_returns_empty_when_billing_is_disabled(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"

        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False, subscription=SimpleNamespace(plan=CloudPlan.PROFESSIONAL))
        )

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.FeatureService.get_features", return_value=features),
            patch("services.dataset_service.db") as mock_db,
        ):
            result = DatasetService.get_dataset_auto_disable_logs("dataset-1")

        assert result == {"document_ids": [], "count": 0}
        mock_db.session.scalars.assert_not_called()

    def test_get_dataset_auto_disable_logs_returns_recent_document_ids(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"
        logs = [SimpleNamespace(document_id="doc-1"), SimpleNamespace(document_id="doc-2")]
        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=True, subscription=SimpleNamespace(plan=CloudPlan.PROFESSIONAL))
        )

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.FeatureService.get_features", return_value=features),
            patch("services.dataset_service.db") as mock_db,
        ):
            mock_db.session.scalars.return_value.all.return_value = logs

            result = DatasetService.get_dataset_auto_disable_logs("dataset-1")

        assert result == {"document_ids": ["doc-1", "doc-2"], "count": 2}


class TestDatasetServiceDocumentIndexing:
    """Unit tests for pause/recover/retry orchestration without SQL assertions."""

    @pytest.fixture
    def mock_document_service_dependencies(self):
        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db.session") as mock_db_session,
            patch("services.dataset_service.current_user") as mock_current_user,
        ):
            mock_current_user.id = "user-123"
            yield {
                "redis_client": mock_redis,
                "db_session": mock_db_session,
                "current_user": mock_current_user,
            }

    def test_pause_document_success(self, mock_document_service_dependencies):
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="indexing")

        DocumentService.pause_document(document)

        assert document.is_paused is True
        assert document.paused_by == "user-123"
        mock_document_service_dependencies["db_session"].add.assert_called_once_with(document)
        mock_document_service_dependencies["db_session"].commit.assert_called_once()
        mock_document_service_dependencies["redis_client"].setnx.assert_called_once_with(
            f"document_{document.id}_is_paused",
            "True",
        )

    def test_pause_document_invalid_status_error(self, mock_document_service_dependencies):
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="completed")

        with pytest.raises(DocumentIndexingError):
            DocumentService.pause_document(document)

    def test_recover_document_success(self, mock_document_service_dependencies):
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="indexing", is_paused=True)

        with patch("services.dataset_service.recover_document_indexing_task") as recover_task:
            DocumentService.recover_document(document)

        assert document.is_paused is False
        assert document.paused_by is None
        assert document.paused_at is None
        mock_document_service_dependencies["db_session"].add.assert_called_once_with(document)
        mock_document_service_dependencies["db_session"].commit.assert_called_once()
        mock_document_service_dependencies["redis_client"].delete.assert_called_once_with(
            f"document_{document.id}_is_paused"
        )
        recover_task.delay.assert_called_once_with(document.dataset_id, document.id)

    def test_retry_document_indexing_success(self, mock_document_service_dependencies):
        dataset_id = "dataset-123"
        documents = [
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1", indexing_status="error"),
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-2", indexing_status="error"),
        ]
        mock_document_service_dependencies["redis_client"].get.return_value = None

        with patch("services.dataset_service.retry_document_indexing_task") as retry_task:
            DocumentService.retry_document(dataset_id, documents)

        assert all(document.indexing_status == "waiting" for document in documents)
        assert mock_document_service_dependencies["db_session"].add.call_count == 2
        assert mock_document_service_dependencies["db_session"].commit.call_count == 2
        assert mock_document_service_dependencies["redis_client"].setex.call_count == 2
        retry_task.delay.assert_called_once_with(dataset_id, ["doc-1", "doc-2"], "user-123")


class TestDatasetCollectionBindingService:
    """Unit tests for dataset collection binding lookups and creation."""

    def test_get_dataset_collection_binding_returns_existing_binding(self):
        binding = SimpleNamespace(id="binding-1")

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = binding

            result = DatasetCollectionBindingService.get_dataset_collection_binding("provider", "model")

        assert result is binding
        mock_db.session.add.assert_not_called()

    def test_get_dataset_collection_binding_creates_binding_when_missing(self):
        created_binding = SimpleNamespace(id="binding-2")

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.DatasetCollectionBinding", return_value=created_binding) as binding_cls,
            patch.object(Dataset, "gen_collection_name_by_id", return_value="generated-collection"),
        ):
            mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = None

            result = DatasetCollectionBindingService.get_dataset_collection_binding("provider", "model", "dataset")

        assert result is created_binding
        binding_cls.assert_called_once_with(
            provider_name="provider",
            model_name="model",
            collection_name="generated-collection",
            type="dataset",
        )
        mock_db.session.add.assert_called_once_with(created_binding)
        mock_db.session.commit.assert_called_once()

    def test_get_dataset_collection_binding_by_id_and_type_raises_when_missing(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = None

            with pytest.raises(ValueError, match="Dataset collection binding not found"):
                DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type("binding-1")

    def test_get_dataset_collection_binding_by_id_and_type_returns_binding(self):
        binding = SimpleNamespace(id="binding-1")

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = binding

            result = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type("binding-1")

        assert result is binding


class TestDatasetPermissionService:
    """Unit tests for dataset partial-member management helpers."""

    def test_get_dataset_partial_member_list_returns_scalar_results(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = ["user-1", "user-2"]

            result = DatasetPermissionService.get_dataset_partial_member_list("dataset-1")

        assert result == ["user-1", "user-2"]

    def test_update_partial_member_list_replaces_permissions_and_commits(self):
        with patch("services.dataset_service.db") as mock_db:
            DatasetPermissionService.update_partial_member_list(
                "tenant-1",
                "dataset-1",
                [{"user_id": "user-1"}, {"user_id": "user-2"}],
            )

        mock_db.session.query.return_value.where.return_value.delete.assert_called_once()
        mock_db.session.add_all.assert_called_once()
        mock_db.session.commit.assert_called_once()

    def test_update_partial_member_list_rolls_back_on_exception(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.add_all.side_effect = RuntimeError("boom")

            with pytest.raises(RuntimeError, match="boom"):
                DatasetPermissionService.update_partial_member_list(
                    "tenant-1",
                    "dataset-1",
                    [{"user_id": "user-1"}],
                )

        mock_db.session.rollback.assert_called_once()

    def test_check_permission_requires_dataset_editor(self):
        user = SimpleNamespace(is_dataset_editor=False, is_dataset_operator=False)
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()

        with pytest.raises(NoPermissionError, match="does not have permission"):
            DatasetPermissionService.check_permission(user, dataset, "all_team", [])

    def test_check_permission_prevents_dataset_operator_from_changing_permission_mode(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(permission="all_team")

        with pytest.raises(NoPermissionError, match="cannot change the dataset permissions"):
            DatasetPermissionService.check_permission(user, dataset, "only_me", [])

    def test_check_permission_requires_partial_member_list_for_partial_members_mode(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(permission="partial_members")

        with pytest.raises(ValueError, match="Partial member list is required"):
            DatasetPermissionService.check_permission(user, dataset, "partial_members", [])

    def test_check_permission_rejects_dataset_operator_member_list_changes(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            dataset_id="dataset-1", permission="partial_members"
        )

        with patch.object(DatasetPermissionService, "get_dataset_partial_member_list", return_value=["user-1"]):
            with pytest.raises(ValueError, match="cannot change the dataset permissions"):
                DatasetPermissionService.check_permission(
                    user,
                    dataset,
                    "partial_members",
                    [{"user_id": "user-2"}],
                )

    def test_check_permission_allows_dataset_operator_when_member_list_is_unchanged(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            dataset_id="dataset-1", permission="partial_members"
        )

        with patch.object(DatasetPermissionService, "get_dataset_partial_member_list", return_value=["user-1"]):
            DatasetPermissionService.check_permission(
                user,
                dataset,
                "partial_members",
                [{"user_id": "user-1"}],
            )

    def test_clear_partial_member_list_deletes_permissions_and_commits(self):
        with patch("services.dataset_service.db") as mock_db:
            DatasetPermissionService.clear_partial_member_list("dataset-1")

        mock_db.session.query.return_value.where.return_value.delete.assert_called_once()
        mock_db.session.commit.assert_called_once()

    def test_clear_partial_member_list_rolls_back_on_exception(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.delete.side_effect = RuntimeError("boom")

            with pytest.raises(RuntimeError, match="boom"):
                DatasetPermissionService.clear_partial_member_list("dataset-1")

        mock_db.session.rollback.assert_called_once()
