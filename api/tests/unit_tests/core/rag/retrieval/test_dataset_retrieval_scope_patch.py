from types import SimpleNamespace
from unittest.mock import patch

from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest


class TestKnowledgeRetrievalProjectPublicScope:
    def test_passes_project_and_public_scope_to_available_dataset_filter(self) -> None:
        retrieval = DatasetRetrieval()
        request = KnowledgeRetrievalRequest(
            tenant_id="tenant-1",
            user_id="user-1",
            app_id="app-1",
            user_from="workflow",
            dataset_ids=["project-dataset", "public-dataset"],
            project_id="project-1",
            include_public=True,
            query="hello",
            retrieval_mode="multiple",
        )

        with (
            patch.object(retrieval, "_check_knowledge_rate_limit"),
            patch.object(
                retrieval,
                "_get_available_datasets",
                return_value=[SimpleNamespace(id="project-dataset"), SimpleNamespace(id="public-dataset")],
            ) as mock_get_available_datasets,
            patch.object(retrieval, "get_metadata_filter_condition", return_value=(None, None)),
            patch.object(retrieval, "multiple_retrieve", return_value=[]),
        ):
            retrieval.knowledge_retrieval(request)

        mock_get_available_datasets.assert_called_once_with(
            "tenant-1",
            ["project-dataset", "public-dataset"],
            project_id="project-1",
            include_public=True,
        )
