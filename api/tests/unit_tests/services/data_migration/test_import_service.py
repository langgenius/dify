import pytest

from services.data_migration.entities import (
    ConflictStrategy,
    IdStrategy,
    ImportOptions,
    ImportTarget,
    MigrationDataError,
    MigrationPackage,
    ResourceReportItem,
)
from services.data_migration.import_service import ImportRequest, ImportTargetResolver, MigrationImportService


def test_target_tenant_precedence_cli_then_config_then_package():
    package = MigrationPackage.from_mapping(
        {
            "metadata": {
                "version": "1",
                "source_scope": "single",
                "source_tenants": [],
                "target_tenant": {"name": "from-package"},
            }
        }
    )

    resolver = ImportTargetResolver()

    assert (
        resolver.select_target_tenant_name(
            ImportRequest(package=package, cli_target_tenant="from-cli", config_target_tenant="from-config")
        )
        == "from-cli"
    )
    assert (
        resolver.select_target_tenant_name(
            ImportRequest(package=package, cli_target_tenant=None, config_target_tenant="from-config")
        )
        == "from-config"
    )
    assert (
        resolver.select_target_tenant_name(
            ImportRequest(package=package, cli_target_tenant=None, config_target_tenant=None)
        )
        == "from-package"
    )


def test_target_tenant_missing_fails_before_import():
    package = MigrationPackage.from_mapping({"metadata": {"version": "1", "source_scope": "single"}})

    with pytest.raises(MigrationDataError, match="Target tenant"):
        ImportTargetResolver().select_target_tenant_name(
            ImportRequest(package=package, cli_target_tenant=None, config_target_tenant=None)
        )


def test_package_target_tenant_id_can_be_used_without_name():
    package = MigrationPackage.from_mapping(
        {"metadata": {"version": "1", "source_scope": "single", "target_tenant": {"id": "tenant-id"}}}
    )

    assert ImportTargetResolver().select_target_tenant_name(ImportRequest(package=package)) == "tenant-id"


def test_options_override_replaces_package_defaults():
    package = MigrationPackage.from_mapping(
        {
            "metadata": {
                "version": "1",
                "source_scope": "single",
                "target_tenant": {"name": "target"},
                "import_options": {
                    "create_app_api_token_on_import": True,
                    "conflict_strategy": "update",
                },
            }
        }
    )
    captured_options: list[ImportOptions] = []

    class StubResolver(ImportTargetResolver):
        def resolve(self, request: ImportRequest) -> ImportTarget:
            return ImportTarget(
                tenant_id="tenant-1",
                tenant_name="target",
                operator_id="account-1",
                operator_email="owner@example.com",
            )

    class CapturingImportService(MigrationImportService):
        def _import_workflows(
            self,
            package: MigrationPackage,
            target: ImportTarget,
            options: ImportOptions,
            report_items: list[ResourceReportItem],
            id_mapping: dict[str, str],
        ) -> None:
            captured_options.append(options)

    override = ImportOptions(create_app_api_token_on_import=False, conflict_strategy=ConflictStrategy.SKIP)

    CapturingImportService(target_resolver=StubResolver()).import_package(
        ImportRequest(package=package, options_override=override)
    )

    assert captured_options == [override]


def test_only_preserve_id_strategy_reuses_source_app_id():
    service = MigrationImportService()

    assert service._should_preserve_source_app_id(ImportOptions(id_strategy=IdStrategy.PRESERVE_ID)) is True
    assert service._should_preserve_source_app_id(ImportOptions(id_strategy=IdStrategy.GENERATE_NEW_ID)) is False
    assert service._should_preserve_source_app_id(ImportOptions(id_strategy=IdStrategy.MAP_ID)) is False
