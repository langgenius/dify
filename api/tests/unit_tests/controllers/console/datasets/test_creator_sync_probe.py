"""Probe: after #42430 flipped dataset create to automatic_include_workspace_members=False,
which create paths still sync the creator's own access?

Broken version / working version harness: mock try_sync_creator_access_policy_member_bindings
and assert whether each public dataset-create controller path calls it.
"""

from unittest.mock import MagicMock, patch

from configs import dify_config
from services.enterprise import rbac_service


def _enterprise_path(module: str) -> str:
    return f"{module}.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings"


def test_create_empty_dataset_calls_creator_sync():
    calls: list[str] = []

    def _fake(*args, **kwargs):
        calls.append("sync")

    from models.dataset import Dataset
    from services.dataset_service import DatasetService

    class FakeAccount:
        id = "user-1"

    session = MagicMock()
    session.scalar.return_value = None
    session.commit.side_effect = lambda: None
    session.flush.side_effect = lambda: None

    with patch.object(
        rbac_service,
        "try_sync_creator_access_policy_member_bindings",
        side_effect=_fake,
    ), patch.object(
        DatasetService,
        "check_embedding_model_setting",
        return_value=None,
    ), patch.object(
        DatasetService,
        "check_reranking_model_setting",
        return_value=None,
    ), patch.object(
        dify_config.mixin if hasattr(dify_config, "mixin") else type(dify_config),
        "RBAC_ENABLED",
        True,
        create=True,
    ):
        # avoid embedding model manager when indexing_technique is None
        ds = DatasetService.create_empty_dataset(
            tenant_id="tenant-1",
            name="probe-ds",
            description="probe",
            indexing_technique=None,
            account=FakeAccount(),
            session=session,
        )
        assert ds is not None
    assert calls == ["sync"], "create_empty_dataset should sync creator access, got %r" % calls


def test_save_document_without_dataset_id_no_creator_sync():
    """Fragment: statically confirm this service path never calls creator sync."""

    from pathlib import Path

    src = Path("services/dataset_service.py").read_text()
    start = src.index("def save_document_without_dataset_id")
    assert "try_sync_creator_access_policy_member_bindings" not in src[start:]
    assert "initialize_created_app_rbac_access_task" not in src[start:]


def test_create_empty_rag_pipeline_dataset_no_creator_sync():
    from pathlib import Path

    src = Path("services/dataset_service.py").read_text()
    start = src.index("def create_empty_rag_pipeline_dataset")
    assert "try_sync_creator_access_policy_member_bindings" not in src[start:]


def test_rag_pipeline_dsl_import_no_creator_sync():
    from pathlib import Path

    src = Path("services/rag_pipeline/rag_pipeline_dsl_service.py").read_text()
    assert "try_sync_creator_access_policy_member_bindings" not in src
    assert "initialize_created_app_rbac_access_task" not in src