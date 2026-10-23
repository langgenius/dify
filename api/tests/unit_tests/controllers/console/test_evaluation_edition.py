from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask_restx import Resource
from werkzeug.exceptions import Forbidden

from controllers.console import evaluation as evaluation_controller
from services.errors.base import NoPermissionError


def test_all_evaluation_resources_require_a_supported_edition() -> None:
    resource_classes = [
        value
        for value in vars(evaluation_controller).values()
        if isinstance(value, type)
        and value.__module__ == evaluation_controller.__name__
        and issubclass(value, Resource)
        and value is not evaluation_controller.EvaluationEditionResource
    ]

    assert resource_classes
    assert all(
        issubclass(resource_class, evaluation_controller.EvaluationEditionResource)
        for resource_class in resource_classes
    )


def test_dataset_permission_denial_returns_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = MagicMock()
    monkeypatch.setattr(evaluation_controller, "dify_config", SimpleNamespace(RBAC_ENABLED=False))
    monkeypatch.setattr(
        evaluation_controller.DatasetService,
        "get_dataset_for_tenant",
        lambda _dataset_id, _tenant_id, _session: dataset,
    )

    def deny_permission(*_args: object) -> None:
        raise NoPermissionError("Dataset access denied")

    monkeypatch.setattr(evaluation_controller.DatasetService, "check_dataset_permission", deny_permission)

    with pytest.raises(Forbidden, match="Dataset access denied"):
        evaluation_controller._get_accessible_dataset(MagicMock(), uuid4(), MagicMock(), "tenant-1")
