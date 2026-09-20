"""app package size limits tests."""

import pytest

from services.agent.errors import RosterAgentPackageTooLargeError
from services.app_package_service import AppPackageService
from services.dsl_content import DSL_MAX_SIZE
from tests.unit_tests.services._app_package_helpers import _archive


def _dsl_with_size(size: int) -> str:
    header = "kind: app\napp:\n  mode: workflow\n  description: "
    padding = size - len(header.encode("utf-8"))
    return header + "\U0001f600" * (padding // 4) + "a" * (padding % 4)


@pytest.mark.parametrize("size", [6 * 1024 * 1024, DSL_MAX_SIZE])
def test_package_round_trip_accepts_large_dsl_within_legacy_limit(size: int) -> None:
    dsl = _dsl_with_size(size)
    service = AppPackageService()
    with service.export(dsl=dsl, name="Large Workflow") as package:
        assert service.read_dsl(package.archive) == dsl


def test_export_rejects_dsl_exceeding_legacy_byte_limit() -> None:
    dsl = _dsl_with_size(DSL_MAX_SIZE + 1)
    with pytest.raises(RosterAgentPackageTooLargeError):
        AppPackageService().export(dsl=dsl, name="Large Workflow")


def test_import_rejects_compressed_dsl_exceeding_legacy_byte_limit() -> None:
    dsl = _dsl_with_size(DSL_MAX_SIZE + 1)
    source = _archive(dsl)
    with pytest.raises(RosterAgentPackageTooLargeError):
        AppPackageService().read_dsl(source)
