from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from models.account import AccountStatus
from services.knowledge_fs.initial_source_preview import KnowledgeFSInitialSourcePreviewCanceledError
from services.knowledge_fs.product_dto import KnowledgeFSInitialSourcePreviewResponse
from tasks.knowledge_fs_initial_source_preview_tasks import run_knowledge_fs_initial_source_preview


def _payload() -> dict[str, object]:
    return {
        "credentialId": "credential-1",
        "datasource": "crawl",
        "kind": "website_crawl",
        "parameters": {"url": "https://docs.dify.ai"},
        "pluginId": "langgenius/firecrawl_datasource",
        "provider": "firecrawl",
    }


def test_preview_task_uses_the_dataset_queue() -> None:
    assert run_knowledge_fs_initial_source_preview.queue == "dataset"


def test_preview_task_persists_running_and_completed_states() -> None:
    account = SimpleNamespace(
        current_tenant_id="tenant-1",
        id="account-1",
        set_tenant_id_with_session=MagicMock(),
        status=AccountStatus.ACTIVE,
    )
    session = MagicMock()
    session.get.return_value = account
    session.scalar.return_value = "membership-1"
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    job_service = MagicMock()
    job_service.transition_status.side_effect = [True, True]
    preview_service = MagicMock()
    result = KnowledgeFSInitialSourcePreviewResponse(kind="website_crawl")
    preview_service.preview.return_value = result

    with (
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.KnowledgeFSInitialSourcePreviewJobService",
            return_value=job_service,
        ),
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.KnowledgeFSInitialSourcePreviewService",
            return_value=preview_service,
        ),
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.session_factory.create_session",
            return_value=session_context,
        ),
        patch("tasks.knowledge_fs_initial_source_preview_tasks.session_factory.get_session_maker"),
    ):
        run_knowledge_fs_initial_source_preview.run(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
            payload=_payload(),
        )

    assert job_service.transition_status.call_args_list == [
        call(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
            status="running",
            allowed_from=("pending",),
        ),
        call(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
            status="completed",
            allowed_from=("running",),
            result=result,
        ),
    ]
    job_service.release_active_job.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        job_id="job-1",
    )
    account.set_tenant_id_with_session.assert_called_once_with("tenant-1", session=session)
    session.expunge.assert_called_once_with(account)
    preview_service.preview.assert_called_once()


def test_preview_task_does_not_start_a_canceled_job() -> None:
    job_service = MagicMock()
    job_service.transition_status.return_value = False

    with (
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.KnowledgeFSInitialSourcePreviewJobService",
            return_value=job_service,
        ),
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.KnowledgeFSInitialSourcePreviewService"
        ) as preview_service,
        patch("tasks.knowledge_fs_initial_source_preview_tasks.session_factory.get_session_maker"),
    ):
        run_knowledge_fs_initial_source_preview.run(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
            payload=_payload(),
        )

    job_service.transition_status.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        job_id="job-1",
        status="running",
        allowed_from=("pending",),
    )
    preview_service.assert_not_called()
    job_service.release_active_job.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        job_id="job-1",
    )


def test_preview_task_keeps_a_cooperatively_canceled_job_terminal() -> None:
    account = SimpleNamespace(
        current_tenant_id="tenant-1",
        id="account-1",
        set_tenant_id_with_session=MagicMock(),
        status=AccountStatus.ACTIVE,
    )
    session = MagicMock()
    session.get.return_value = account
    session.scalar.return_value = "membership-1"
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    job_service = MagicMock()
    job_service.transition_status.return_value = True
    job_service.get.return_value = SimpleNamespace(status="canceled")
    preview_service = MagicMock()

    def preview(**kwargs):
        assert kwargs["is_canceled"]() is True
        raise KnowledgeFSInitialSourcePreviewCanceledError("canceled")

    preview_service.preview.side_effect = preview
    with (
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.KnowledgeFSInitialSourcePreviewJobService",
            return_value=job_service,
        ),
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.KnowledgeFSInitialSourcePreviewService",
            return_value=preview_service,
        ),
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.session_factory.create_session",
            return_value=session_context,
        ),
        patch("tasks.knowledge_fs_initial_source_preview_tasks.session_factory.get_session_maker"),
    ):
        run_knowledge_fs_initial_source_preview.run(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
            payload=_payload(),
        )

    job_service.transition_status.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        job_id="job-1",
        status="running",
        allowed_from=("pending",),
    )


def test_preview_task_rejects_an_account_removed_from_the_tenant() -> None:
    account = SimpleNamespace(
        current_tenant_id=None,
        id="account-1",
        set_tenant_id_with_session=MagicMock(),
        status=AccountStatus.ACTIVE,
    )
    session = MagicMock()
    session.get.return_value = account
    session.scalar.return_value = None
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    job_service = MagicMock()
    job_service.transition_status.side_effect = [True, True]

    with (
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.KnowledgeFSInitialSourcePreviewJobService",
            return_value=job_service,
        ),
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.KnowledgeFSInitialSourcePreviewService"
        ) as preview_service,
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.session_factory.create_session",
            return_value=session_context,
        ),
        patch("tasks.knowledge_fs_initial_source_preview_tasks.session_factory.get_session_maker"),
    ):
        run_knowledge_fs_initial_source_preview.run(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
            payload=_payload(),
        )

    preview_service.assert_not_called()
    assert job_service.transition_status.call_args_list[-1] == call(
        tenant_id="tenant-1",
        account_id="account-1",
        job_id="job-1",
        status="failed",
        allowed_from=("pending", "running"),
    )
