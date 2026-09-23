from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.datastructures import FileStorage

import services.annotation_service as annotation_service_module
from enums import DeploymentEdition
from services.annotation_service import AppAnnotationService
from tests.unit_tests.config_override import config_overrides_context


def test_batch_import_preserves_literal_na(monkeypatch: pytest.MonkeyPatch) -> None:
    account = SimpleNamespace(id="account-1")
    monkeypatch.setattr(
        annotation_service_module,
        "current_account_with_tenant",
        lambda: (account, "tenant-1"),
    )

    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(id="app-1")
    file = FileStorage(
        stream=BytesIO(b"question,answer\nNA,valid answer\nvalid question,NA\n"),
        filename="annotations.csv",
        content_type="text/csv",
    )

    with (
        patch.object(annotation_service_module, "batch_import_annotations_task") as task,
        patch.object(annotation_service_module, "redis_client"),
        patch.object(annotation_service_module.uuid, "uuid4", return_value="job-1"),
        config_overrides_context(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            ANNOTATION_IMPORT_MAX_RECORDS=5,
            ANNOTATION_IMPORT_MIN_RECORDS=1,
        ),
    ):
        result = AppAnnotationService.batch_import_app_annotations("app-1", file, session)

    assert result == {"job_id": "job-1", "job_status": "waiting", "record_count": 2}
    task.delay.assert_called_once()
    assert task.delay.call_args.args[1] == [
        {"question": "NA", "answer": "valid answer"},
        {"question": "valid question", "answer": "NA"},
    ]
