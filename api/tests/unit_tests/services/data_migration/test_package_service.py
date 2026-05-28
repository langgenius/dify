import json

import pytest

from services.data_migration.entities import MigrationDataError
from services.data_migration.package_service import MigrationPackageService


def test_load_package_rejects_branch_draft_shape(tmp_path):
    package_file = tmp_path / "draft.json"
    package_file.write_text(json.dumps({"workflows": [], "tools": []}), encoding="utf-8")

    with pytest.raises(MigrationDataError, match="metadata.version"):
        MigrationPackageService().load_package(package_file)


def test_load_package_rejects_unsupported_version(tmp_path):
    package_file = tmp_path / "future.json"
    package_file.write_text(json.dumps({"metadata": {"version": "999", "source_scope": "single"}}), encoding="utf-8")

    with pytest.raises(MigrationDataError, match="Unsupported migration package version"):
        MigrationPackageService().load_package(package_file)


def test_save_package_writes_versioned_shape(tmp_path):
    output_file = tmp_path / "migration-data.json"
    package = MigrationPackageService().build_empty_package(
        source_tenant_id="tenant-1",
        source_tenant_name="source",
        include_secrets=False,
    )

    MigrationPackageService().save_package(package, output_file, overwrite=False)

    data = json.loads(output_file.read_text(encoding="utf-8"))
    assert data["metadata"]["version"] == "1"
    assert data["metadata"]["source_tenants"] == [{"id": "tenant-1", "name": "source"}]
    assert data["metadata"]["include_secrets"] is False
    assert data["workflows"] == []
    assert data["dependencies"] == []


def test_save_package_without_overwrite_fails_when_file_exists(tmp_path):
    output_file = tmp_path / "migration-data.json"
    output_file.write_text("{}", encoding="utf-8")
    package = MigrationPackageService().build_empty_package(
        source_tenant_id="tenant-1",
        source_tenant_name="source",
        include_secrets=False,
    )

    with pytest.raises(MigrationDataError, match="already exists"):
        MigrationPackageService().save_package(package, output_file, overwrite=False)
