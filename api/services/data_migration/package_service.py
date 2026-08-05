"""JSON persistence for versioned cross-environment migration packages.

The package service validates file shape and serializes only structured package
entities. It does not perform CLI rendering or database access, keeping it safe
to reuse from Click adapters, tests, and future import/export services.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from services.data_migration.entities import (
    ImportOptions,
    MigrationDataError,
    MigrationMetadata,
    MigrationPackage,
    SourceTenant,
    TargetTenantSelector,
)

PACKAGE_VERSION = "1"


class MigrationPackageService:
    def load_package(self, path: str | Path) -> MigrationPackage:
        package_path = Path(path)
        with package_path.open(encoding="utf-8") as file:
            raw = json.load(file)
        if not isinstance(raw, dict):
            raise MigrationDataError("Migration package JSON must be an object.")
        package = MigrationPackage.from_mapping(raw)
        if package.metadata.version != PACKAGE_VERSION:
            raise MigrationDataError(f"Unsupported migration package version: {package.metadata.version}")
        return package

    def save_package(self, package: MigrationPackage, path: str | Path, *, overwrite: bool) -> None:
        package_path = Path(path)
        if package_path.exists() and not overwrite:
            raise MigrationDataError(f"Output file already exists: {package_path}")
        package_path.parent.mkdir(parents=True, exist_ok=True)
        with package_path.open("w", encoding="utf-8") as file:
            json.dump(self.to_mapping(package), file, ensure_ascii=False, indent=2)
            file.write("\n")

    def build_empty_package(
        self,
        *,
        source_tenant_id: str,
        source_tenant_name: str,
        include_secrets: bool,
        import_options: ImportOptions | None = None,
        target_tenant: TargetTenantSelector | None = None,
    ) -> MigrationPackage:
        return MigrationPackage(
            metadata=MigrationMetadata(
                version=PACKAGE_VERSION,
                source_scope="single",
                source_tenants=[SourceTenant(id=source_tenant_id, name=source_tenant_name)],
                target_tenant=target_tenant,
                created_at=datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                include_secrets=include_secrets,
                import_options=import_options or ImportOptions(),
            )
        )

    def to_mapping(self, package: MigrationPackage) -> dict[str, Any]:
        return asdict(package)
