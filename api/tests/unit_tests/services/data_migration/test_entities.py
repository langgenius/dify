import pytest

from services.data_migration.entities import (
    ConflictStrategy,
    IdStrategy,
    ImportOptions,
    MigrationDataError,
    MigrationMetadata,
    MigrationPackage,
    SourceTenant,
)


def test_import_options_defaults_match_spec():
    options = ImportOptions()

    assert options.create_app_api_token_on_import is False
    assert options.id_strategy == IdStrategy.PRESERVE_ID
    assert options.conflict_strategy == ConflictStrategy.FAIL


def test_metadata_requires_version():
    with pytest.raises(MigrationDataError, match="metadata.version"):
        MigrationMetadata.from_mapping({})


def test_metadata_parses_source_tenants_and_import_options():
    metadata = MigrationMetadata.from_mapping(
        {
            "version": "1",
            "source_scope": "single",
            "source_tenants": [{"id": "tenant-1", "name": "source"}],
            "target_tenant": {"name": "prod"},
            "include_secrets": False,
            "import_options": {"conflict_strategy": "update"},
        }
    )

    assert metadata.version == "1"
    assert metadata.source_scope == "single"
    assert metadata.source_tenants == [SourceTenant(id="tenant-1", name="source")]
    assert metadata.target_tenant == {"name": "prod"}
    assert metadata.import_options.conflict_strategy == ConflictStrategy.UPDATE
    assert metadata.import_options.id_strategy == IdStrategy.PRESERVE_ID


def test_import_options_invalid_strategy_raises_domain_error():
    with pytest.raises(MigrationDataError, match="id_strategy"):
        ImportOptions.from_mapping({"id_strategy": "unknown"})

    with pytest.raises(MigrationDataError, match="id_strategy"):
        ImportOptions.from_mapping({"id_strategy": "map-id"})

    with pytest.raises(MigrationDataError, match="conflict_strategy"):
        ImportOptions.from_mapping({"conflict_strategy": "unknown"})

    with pytest.raises(MigrationDataError, match="conflict_strategy"):
        ImportOptions.from_mapping({"conflict_strategy": "replace"})


def test_metadata_rejects_invalid_target_tenant_shape():
    with pytest.raises(MigrationDataError, match="target_tenant"):
        MigrationMetadata.from_mapping({"version": "1", "target_tenant": "prod"})


def test_migration_package_sections_must_be_lists_of_objects():
    with pytest.raises(MigrationDataError, match="workflows"):
        MigrationPackage.from_mapping({"metadata": {"version": "1"}, "workflows": {"id": "app-1"}})

    with pytest.raises(MigrationDataError, match="tools"):
        MigrationPackage.from_mapping({"metadata": {"version": "1"}, "tools": ["weather"]})
