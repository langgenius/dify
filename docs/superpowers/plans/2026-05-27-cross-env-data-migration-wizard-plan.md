# Cross-Environment Data Migration Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the draft custom-data migration CLI with versioned migration-data export/import services and a safe single-tenant export wizard.

**Architecture:** Move migration business logic from `api/commands/system.py` into `api/services/data_migration/`. Commands become thin Click adapters that load config, run the services, and render structured reports. The first version keeps scriptable export/import, adds a wizard that directly writes the final migration package, makes target tenant explicit on import, and defaults to secret-free output.

**Tech Stack:** Python 3.12, Flask Click commands, SQLAlchemy via existing `extensions.ext_database.db`, Dify services/models, `pytest`, `ruff`.

---

## File Map

- Create `api/services/data_migration/__init__.py`: package exports for the new service layer.
- Create `api/services/data_migration/entities.py`: typed dataclasses/enums for package metadata, selections, import options, reports, and errors.
- Create `api/services/data_migration/package_service.py`: JSON load/save and package/config validation.
- Create `api/services/data_migration/report_service.py`: CLI-friendly report rendering from structured results.
- Create `api/services/data_migration/dependency_discovery_service.py`: graph scanning and de-duplication for referenced tools.
- Create `api/services/data_migration/export_service.py`: tenant-scoped package building for workflows, API tools, workflow tools, MCP tools, and dependency metadata.
- Create `api/services/data_migration/import_service.py`: target tenant/operator resolution and package application with explicit strategies.
- Create `api/commands/data_migration.py`: `export-migration-data`, `import-migration-data`, and `migration-data-wizard` Click commands.
- Modify `api/commands/system.py`: remove the branch-only draft migration command implementation from this generic system command module.
- Modify `api/commands/__init__.py`: export the new command symbols and stop exporting draft command names.
- Modify `api/extensions/ext_commands.py`: register only the new migration-data command names.
- Keep existing support changes in `api/services/app_dsl_service.py`, `api/services/tools/workflow_tools_manage_service.py`, `api/core/tools/tool_manager.py`, and `api/core/tools/utils/parser.py` unless tests show they need tightening.
- Create `api/tests/unit_tests/services/data_migration/`: pure unit tests for entities, package service, dependency discovery, and report rendering.
- Create `api/tests/unit_tests/commands/test_data_migration_commands.py`: command adapter tests for option parsing and registration where feasible.

## Decisions Locked By Spec

- Command names are `export-migration-data`, `import-migration-data`, and `migration-data-wizard`.
- Do not keep legacy wrappers for `export-custom-data`, `import-custom-data`, or `migration-custom-datas`; this feature has not shipped.
- Migration packages must include `metadata.version`; missing version fails with an actionable format error.
- Wizard v1 supports exactly one source tenant; no `all tenants` option and no per-app target tenant mapping.
- Wizard writes the final migration package JSON directly; it does not persist a separate plan file.
- Export is secret-free by default: API tool credentials omitted, workflow secrets omitted, MCP providers dependency-only, credential IDs removed or reported as unresolved.
- Import resolves target tenant once before writes. Precedence: CLI `--target-tenant`, import config `target_tenant`, package `metadata.target_tenant`.
- Import defaults: `id_strategy=preserve-id`, `conflict_strategy=fail`, `create_app_api_token_on_import=false`.
- Workflow tools manually selected outside selected apps are independent tool resources; do not reverse-include apps because of manual workflow-tool selection.

## Task 1: Typed Entities And Validation Errors

**Files:**
- Create: `api/services/data_migration/__init__.py`
- Create: `api/services/data_migration/entities.py`
- Test: `api/tests/unit_tests/services/data_migration/test_entities.py`

- [ ] **Step 1: Write failing tests for defaults and validation**

Create `api/tests/unit_tests/services/data_migration/test_entities.py`:

```python
import pytest

from services.data_migration.entities import (
    ConflictStrategy,
    IdStrategy,
    ImportOptions,
    MigrationDataError,
    MigrationMetadata,
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/services/data_migration/test_entities.py -q
```

Expected: import failure because `services.data_migration.entities` does not exist.

- [ ] **Step 3: Implement entity types**

Create `api/services/data_migration/entities.py` with:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal, TypedDict


class MigrationDataError(ValueError):
    """Raised when migration config or package data is invalid."""


class IdStrategy(StrEnum):
    PRESERVE_ID = "preserve-id"
    GENERATE_NEW_ID = "generate-new-id"
    MAP_ID = "map-id"


class ConflictStrategy(StrEnum):
    FAIL = "fail"
    SKIP = "skip"
    UPDATE = "update"
    REPLACE = "replace"


class ResourceType(StrEnum):
    WORKFLOW = "workflow"
    API_TOOL = "api_tool"
    WORKFLOW_TOOL = "workflow_tool"
    MCP_TOOL = "mcp_tool"
    DEPENDENCY = "dependency"


class DependencyKind(StrEnum):
    API_TOOL = "api_tool"
    WORKFLOW_TOOL = "workflow_tool"
    MCP_TOOL = "mcp_tool"
    BUILTIN_OR_PLUGIN_TOOL = "builtin_or_plugin_tool"
    UNRESOLVED = "unresolved"


class TargetTenantSelector(TypedDict, total=False):
    id: str
    name: str


@dataclass(frozen=True)
class SourceTenant:
    id: str
    name: str

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> SourceTenant:
        return cls(id=str(value.get("id", "")), name=str(value.get("name", "")))


@dataclass(frozen=True)
class ImportOptions:
    create_app_api_token_on_import: bool = False
    id_strategy: IdStrategy = IdStrategy.PRESERVE_ID
    conflict_strategy: ConflictStrategy = ConflictStrategy.FAIL

    @classmethod
    def from_mapping(cls, value: dict[str, Any] | None) -> ImportOptions:
        value = value or {}
        return cls(
            create_app_api_token_on_import=bool(value.get("create_app_api_token_on_import", False)),
            id_strategy=IdStrategy(value.get("id_strategy", IdStrategy.PRESERVE_ID)),
            conflict_strategy=ConflictStrategy(value.get("conflict_strategy", ConflictStrategy.FAIL)),
        )


@dataclass(frozen=True)
class MigrationMetadata:
    version: str
    source_scope: Literal["single"]
    source_tenants: list[SourceTenant]
    target_tenant: TargetTenantSelector | None = None
    created_at: str | None = None
    include_secrets: bool = False
    import_options: ImportOptions = field(default_factory=ImportOptions)

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> MigrationMetadata:
        version = value.get("version")
        if not version:
            raise MigrationDataError("Migration package must include metadata.version.")
        source_scope = value.get("source_scope", "single")
        if source_scope != "single":
            raise MigrationDataError(f"Unsupported source_scope: {source_scope}")
        source_tenants = [
            SourceTenant.from_mapping(item)
            for item in value.get("source_tenants", [])
            if isinstance(item, dict)
        ]
        return cls(
            version=str(version),
            source_scope="single",
            source_tenants=source_tenants,
            target_tenant=value.get("target_tenant"),
            created_at=value.get("created_at"),
            include_secrets=bool(value.get("include_secrets", False)),
            import_options=ImportOptions.from_mapping(value.get("import_options")),
        )


@dataclass(frozen=True)
class MigrationPackage:
    metadata: MigrationMetadata
    workflows: list[dict[str, Any]] = field(default_factory=list)
    tools: list[dict[str, Any]] = field(default_factory=list)
    workflow_tools: list[dict[str, Any]] = field(default_factory=list)
    mcp_tools: list[dict[str, Any]] = field(default_factory=list)
    dependencies: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> MigrationPackage:
        metadata_value = value.get("metadata")
        if not isinstance(metadata_value, dict):
            raise MigrationDataError("Migration package must include metadata.version.")
        return cls(
            metadata=MigrationMetadata.from_mapping(metadata_value),
            workflows=list(value.get("workflows", [])),
            tools=list(value.get("tools", [])),
            workflow_tools=list(value.get("workflow_tools", [])),
            mcp_tools=list(value.get("mcp_tools", [])),
            dependencies=list(value.get("dependencies", [])),
        )


@dataclass(frozen=True)
class ExportSelection:
    source_tenant_name: str
    app_ids: list[str]
    export_all_apps: bool = False
    include_referenced_tools: bool = True
    additional_api_tools: list[str] = field(default_factory=list)
    additional_workflow_tools: list[str] = field(default_factory=list)
    additional_mcp_tools: list[str] = field(default_factory=list)
    include_secrets: bool = False
    import_options: ImportOptions = field(default_factory=ImportOptions)


@dataclass(frozen=True)
class ResourceReportItem:
    resource_type: ResourceType
    identifier: str
    name: str | None
    status: str
    message: str | None = None


@dataclass(frozen=True)
class ExportResult:
    package: MigrationPackage
    report_items: list[ResourceReportItem]


@dataclass(frozen=True)
class ImportTarget:
    tenant_id: str
    tenant_name: str
    operator_id: str
    operator_email: str | None


@dataclass(frozen=True)
class ImportResult:
    report_items: list[ResourceReportItem]
    id_mapping: dict[str, str] = field(default_factory=dict)
```

Create `api/services/data_migration/__init__.py`:

```python
from services.data_migration.entities import (
    ConflictStrategy,
    ExportSelection,
    IdStrategy,
    ImportOptions,
    MigrationDataError,
    MigrationPackage,
)

__all__ = [
    "ConflictStrategy",
    "ExportSelection",
    "IdStrategy",
    "ImportOptions",
    "MigrationDataError",
    "MigrationPackage",
]
```

- [ ] **Step 4: Run tests and type/lint for the new package**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/services/data_migration/test_entities.py -q
uv run --project api ruff check api/services/data_migration api/tests/unit_tests/services/data_migration/test_entities.py
```

Expected: tests pass and ruff reports no issues.

## Task 2: Package Service

**Files:**
- Create: `api/services/data_migration/package_service.py`
- Test: `api/tests/unit_tests/services/data_migration/test_package_service.py`

- [ ] **Step 1: Write failing tests for load/save and draft rejection**

Create `api/tests/unit_tests/services/data_migration/test_package_service.py`:

```python
import json

import pytest

from services.data_migration.entities import MigrationDataError
from services.data_migration.package_service import MigrationPackageService


def test_load_package_rejects_branch_draft_shape(tmp_path):
    package_file = tmp_path / "draft.json"
    package_file.write_text(json.dumps({"workflows": [], "tools": []}), encoding="utf-8")

    with pytest.raises(MigrationDataError, match="metadata.version"):
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
```

- [ ] **Step 2: Run tests and confirm package service is missing**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/services/data_migration/test_package_service.py -q
```

Expected: import failure for `MigrationPackageService`.

- [ ] **Step 3: Implement `MigrationPackageService`**

Create `api/services/data_migration/package_service.py`:

```python
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from services.data_migration.entities import ImportOptions, MigrationDataError, MigrationMetadata, MigrationPackage, SourceTenant


PACKAGE_VERSION = "1"


class MigrationPackageService:
    def load_package(self, path: str | Path) -> MigrationPackage:
        package_path = Path(path)
        with package_path.open(encoding="utf-8") as file:
            raw = json.load(file)
        if not isinstance(raw, dict):
            raise MigrationDataError("Migration package JSON must be an object.")
        return MigrationPackage.from_mapping(raw)

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
        target_tenant: dict[str, str] | None = None,
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
```

- [ ] **Step 4: Run package tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/services/data_migration/test_entities.py api/tests/unit_tests/services/data_migration/test_package_service.py -q
uv run --project api ruff check api/services/data_migration api/tests/unit_tests/services/data_migration
```

Expected: tests pass and ruff reports no issues.

## Task 3: Dependency Discovery

**Files:**
- Create: `api/services/data_migration/dependency_discovery_service.py`
- Test: `api/tests/unit_tests/services/data_migration/test_dependency_discovery_service.py`

- [ ] **Step 1: Write failing tests for standalone and agent tool nodes**

Create `api/tests/unit_tests/services/data_migration/test_dependency_discovery_service.py`:

```python
from services.data_migration.dependency_discovery_service import DependencyDiscoveryService
from services.data_migration.entities import DependencyKind


def test_discovers_and_deduplicates_standalone_tool_nodes():
    graph = {
        "graph": {
            "nodes": [
                {"data": {"type": "tool", "provider_type": "api", "provider_id": "weather"}},
                {"data": {"type": "tool", "provider_type": "api", "provider_id": "weather"}},
                {"data": {"type": "tool", "provider_type": "workflow", "provider_id": "wf-tool-1"}},
                {"data": {"type": "tool", "provider_type": "builtin", "provider_id": "google_search"}},
            ]
        }
    }

    dependencies = DependencyDiscoveryService().discover_from_dsl(graph)

    assert [(item.kind, item.provider_id) for item in dependencies] == [
        (DependencyKind.API_TOOL, "weather"),
        (DependencyKind.WORKFLOW_TOOL, "wf-tool-1"),
        (DependencyKind.BUILTIN_OR_PLUGIN_TOOL, "google_search"),
    ]


def test_discovers_agent_node_tools():
    graph = {
        "graph": {
            "nodes": [
                {
                    "data": {
                        "type": "agent",
                        "tools": [
                            {"provider_type": "mcp", "provider_id": "mcp-1"},
                            {"provider_type": "api", "provider_id": "api-1"},
                        ],
                    }
                }
            ]
        }
    }

    dependencies = DependencyDiscoveryService().discover_from_dsl(graph)

    assert [(item.kind, item.provider_id) for item in dependencies] == [
        (DependencyKind.MCP_TOOL, "mcp-1"),
        (DependencyKind.API_TOOL, "api-1"),
    ]
```

- [ ] **Step 2: Implement discovery dataclass and service**

Create `api/services/data_migration/dependency_discovery_service.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from services.data_migration.entities import DependencyKind


@dataclass(frozen=True)
class DiscoveredDependency:
    kind: DependencyKind
    provider_id: str
    provider_name: str | None = None
    source: str | None = None


class DependencyDiscoveryService:
    def discover_from_dsl(self, dsl: dict[str, Any]) -> list[DiscoveredDependency]:
        seen: set[tuple[DependencyKind, str]] = set()
        result: list[DiscoveredDependency] = []
        graph = dsl.get("graph") if isinstance(dsl, dict) else None
        nodes = graph.get("nodes", []) if isinstance(graph, dict) else []
        for node in nodes:
            data = node.get("data", {}) if isinstance(node, dict) else {}
            for dependency in self._dependencies_from_node(data):
                key = (dependency.kind, dependency.provider_id)
                if dependency.provider_id and key not in seen:
                    seen.add(key)
                    result.append(dependency)
        return result

    def _dependencies_from_node(self, data: dict[str, Any]) -> list[DiscoveredDependency]:
        dependencies: list[DiscoveredDependency] = []
        node_type = data.get("type")
        if node_type == "tool":
            dependency = self._from_tool_config(data, source="tool_node")
            if dependency:
                dependencies.append(dependency)
        if node_type == "agent":
            for tool_config in data.get("tools", []):
                if isinstance(tool_config, dict):
                    dependency = self._from_tool_config(tool_config, source="agent_node")
                    if dependency:
                        dependencies.append(dependency)
        return dependencies

    def _from_tool_config(self, config: dict[str, Any], *, source: str) -> DiscoveredDependency | None:
        provider_id = config.get("provider_id") or config.get("provider_name") or config.get("provider")
        if not provider_id:
            return None
        provider_type = str(config.get("provider_type") or config.get("type") or "")
        kind = self._kind_from_provider_type(provider_type)
        return DiscoveredDependency(
            kind=kind,
            provider_id=str(provider_id),
            provider_name=config.get("provider_name"),
            source=source,
        )

    def _kind_from_provider_type(self, provider_type: str) -> DependencyKind:
        normalized = provider_type.lower()
        if normalized in {"api", "custom", "api_tool"}:
            return DependencyKind.API_TOOL
        if normalized in {"workflow", "workflow_tool"}:
            return DependencyKind.WORKFLOW_TOOL
        if normalized == "mcp":
            return DependencyKind.MCP_TOOL
        return DependencyKind.BUILTIN_OR_PLUGIN_TOOL
```

- [ ] **Step 3: Run dependency tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/services/data_migration/test_dependency_discovery_service.py -q
uv run --project api ruff check api/services/data_migration/dependency_discovery_service.py api/tests/unit_tests/services/data_migration/test_dependency_discovery_service.py
```

Expected: tests pass and ruff reports no issues.

## Task 4: Export Service

**Files:**
- Create: `api/services/data_migration/export_service.py`
- Test: `api/tests/unit_tests/services/data_migration/test_export_service.py`

- [ ] **Step 1: Write tests for config parsing and secret defaults**

Create `api/tests/unit_tests/services/data_migration/test_export_service.py` with pure config tests first:

```python
from services.data_migration.entities import ConflictStrategy, IdStrategy
from services.data_migration.export_service import ExportConfigParser


def test_export_config_parser_accepts_new_scripted_shape():
    selection = ExportConfigParser().parse(
        {
            "source_tenant": {"mode": "single", "name": "admin's Workspace"},
            "apps": {"modes": ["workflow", "advanced-chat"], "ids": ["app-1"], "all": False},
            "include_referenced_tools": True,
            "additional_tools": {
                "api_tools": ["weather"],
                "workflow_tools": ["workflow-tool-1"],
                "mcp_tools": ["mcp-1"],
            },
            "include_secrets": False,
            "import_options": {
                "create_app_api_token_on_import": True,
                "id_strategy": "preserve-id",
                "conflict_strategy": "fail",
            },
        }
    )

    assert selection.source_tenant_name == "admin's Workspace"
    assert selection.app_ids == ["app-1"]
    assert selection.export_all_apps is False
    assert selection.additional_api_tools == ["weather"]
    assert selection.additional_workflow_tools == ["workflow-tool-1"]
    assert selection.additional_mcp_tools == ["mcp-1"]
    assert selection.include_secrets is False
    assert selection.import_options.create_app_api_token_on_import is True
    assert selection.import_options.id_strategy == IdStrategy.PRESERVE_ID
    assert selection.import_options.conflict_strategy == ConflictStrategy.FAIL


def test_export_config_parser_defaults_to_secret_free_all_apps():
    selection = ExportConfigParser().parse(
        {
            "source_tenant": {"name": "source"},
            "apps": {"all": True},
        }
    )

    assert selection.export_all_apps is True
    assert selection.include_referenced_tools is True
    assert selection.include_secrets is False
```

- [ ] **Step 2: Implement config parser and service skeleton**

Create `api/services/data_migration/export_service.py`:

```python
from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from graphon.model_runtime.utils.encoders import jsonable_encoder

from core.tools.tool_manager import ToolManager
from extensions.ext_database import db
from models import Account, Tenant
from models.account import TenantAccountJoin
from models.model import App
from models.tools import MCPToolProvider
from services.app_dsl_service import AppDslService
from services.data_migration.dependency_discovery_service import DependencyDiscoveryService, DiscoveredDependency
from services.data_migration.entities import (
    DependencyKind,
    ExportResult,
    ExportSelection,
    ImportOptions,
    MigrationDataError,
    ResourceReportItem,
    ResourceType,
)
from services.data_migration.package_service import MigrationPackageService
from services.tools.workflow_tools_manage_service import WorkflowToolManageService


class ExportConfigParser:
    def parse(self, data: dict[str, Any]) -> ExportSelection:
        source_tenant = data.get("source_tenant") or {}
        source_tenant_name = source_tenant.get("name") or data.get("tenant_name")
        if not source_tenant_name:
            raise MigrationDataError("Export config must include source_tenant.name.")
        apps = data.get("apps") or {}
        additional_tools = data.get("additional_tools") or {}
        return ExportSelection(
            source_tenant_name=str(source_tenant_name),
            app_ids=list(apps.get("ids", data.get("workflows", []))),
            export_all_apps=bool(apps.get("all", data.get("export_all_workflows", False))),
            include_referenced_tools=bool(data.get("include_referenced_tools", True)),
            additional_api_tools=list(additional_tools.get("api_tools", data.get("tools", []))),
            additional_workflow_tools=list(additional_tools.get("workflow_tools", data.get("workflow_tools", []))),
            additional_mcp_tools=list(additional_tools.get("mcp_tools", data.get("mcp_tools", []))),
            include_secrets=bool(data.get("include_secrets", False)),
            import_options=ImportOptions.from_mapping(data.get("import_options")),
        )


class MigrationExportService:
    def __init__(
        self,
        *,
        package_service: MigrationPackageService | None = None,
        dependency_discovery_service: DependencyDiscoveryService | None = None,
    ) -> None:
        self.package_service = package_service or MigrationPackageService()
        self.dependency_discovery_service = dependency_discovery_service or DependencyDiscoveryService()

    def export(self, selection: ExportSelection) -> ExportResult:
        tenant = self._get_tenant(selection.source_tenant_name)
        package = self.package_service.build_empty_package(
            source_tenant_id=tenant.id,
            source_tenant_name=tenant.name,
            include_secrets=selection.include_secrets,
            import_options=selection.import_options,
        )
        report_items: list[ResourceReportItem] = []
        apps = self._selected_apps(tenant.id, selection)
        discovered_dependencies: list[DiscoveredDependency] = []
        for app in apps:
            dsl = AppDslService.export_dsl(app_model=app, include_secret=selection.include_secrets)
            package.workflows.append(
                {
                    "id": app.id,
                    "name": app.name,
                    "dsl": dsl,
                    "source_tenant_id": tenant.id,
                    "create_app_api_token_on_import": selection.import_options.create_app_api_token_on_import,
                }
            )
            report_items.append(ResourceReportItem(ResourceType.WORKFLOW, app.id, app.name, "exported"))
            if selection.include_referenced_tools:
                discovered_dependencies.extend(self.dependency_discovery_service.discover_from_dsl(dsl))
        self._export_api_tools(tenant.id, selection, discovered_dependencies, package.tools, report_items)
        self._export_workflow_tools(tenant, selection, discovered_dependencies, package.workflow_tools, report_items)
        self._export_mcp_tools(tenant.id, selection, discovered_dependencies, package.mcp_tools, package.dependencies, report_items)
        self._record_dependency_metadata(discovered_dependencies, package.dependencies, report_items)
        return ExportResult(package=package, report_items=report_items)

    def _get_tenant(self, tenant_name: str) -> Tenant:
        tenant = db.session.scalar(sa.select(Tenant).where(Tenant.name == tenant_name))
        if tenant is None:
            raise MigrationDataError(f"Source tenant not found: {tenant_name}")
        return tenant

    def _selected_apps(self, tenant_id: str, selection: ExportSelection) -> list[App]:
        query = sa.select(App).where(App.tenant_id == tenant_id, App.mode.in_(["workflow", "advanced-chat"]))
        if not selection.export_all_apps:
            query = query.where(App.id.in_(selection.app_ids))
        apps = list(db.session.scalars(query).all())
        if not selection.export_all_apps and len(apps) != len(set(selection.app_ids)):
            found_ids = {app.id for app in apps}
            missing_ids = [app_id for app_id in selection.app_ids if app_id not in found_ids]
            raise MigrationDataError(f"Selected app IDs not found in source tenant: {missing_ids}")
        return apps

    def _export_api_tools(
        self,
        tenant_id: str,
        selection: ExportSelection,
        discovered_dependencies: list[DiscoveredDependency],
        output: list[dict[str, Any]],
        report_items: list[ResourceReportItem],
    ) -> None:
        provider_names = self._unique(
            selection.additional_api_tools
            + [item.provider_id for item in discovered_dependencies if item.kind == DependencyKind.API_TOOL]
        )
        for provider_name in provider_names:
            tool_dict = ToolManager.user_get_api_provider(
                provider=provider_name,
                tenant_id=tenant_id,
                mask=not selection.include_secrets,
            )
            tool_dict["provider_name"] = provider_name
            tool_dict["source_tenant_id"] = tenant_id
            tool_dict.pop("tools", None)
            if not selection.include_secrets:
                tool_dict.pop("credentials", None)
            output.append(tool_dict)
            report_items.append(ResourceReportItem(ResourceType.API_TOOL, provider_name, provider_name, "exported"))

    def _export_workflow_tools(
        self,
        tenant: Tenant,
        selection: ExportSelection,
        discovered_dependencies: list[DiscoveredDependency],
        output: list[dict[str, Any]],
        report_items: list[ResourceReportItem],
    ) -> None:
        workflow_tool_ids = self._unique(
            selection.additional_workflow_tools
            + [item.provider_id for item in discovered_dependencies if item.kind == DependencyKind.WORKFLOW_TOOL]
        )
        if not workflow_tool_ids:
            return
        account = self._get_operator_account(tenant.id)
        for workflow_tool_id in workflow_tool_ids:
            tool_info = WorkflowToolManageService.get_workflow_tool_by_tool_id(
                user_id=account.id,
                tenant_id=tenant.id,
                workflow_tool_id=workflow_tool_id,
            )
            tool_dict = jsonable_encoder(tool_info)
            tool_dict["id"] = workflow_tool_id
            tool_dict["app_id"] = tool_dict.get("workflow_app_id")
            tool_dict["source_tenant_id"] = tenant.id
            for key in ["workflow_tool_id", "workflow_app_id", "tool"]:
                tool_dict.pop(key, None)
            output.append(tool_dict)
            report_items.append(ResourceReportItem(ResourceType.WORKFLOW_TOOL, workflow_tool_id, tool_dict.get("name"), "exported"))

    def _export_mcp_tools(
        self,
        tenant_id: str,
        selection: ExportSelection,
        discovered_dependencies: list[DiscoveredDependency],
        output: list[dict[str, Any]],
        dependency_output: list[dict[str, Any]],
        report_items: list[ResourceReportItem],
    ) -> None:
        mcp_ids = self._unique(
            selection.additional_mcp_tools
            + [item.provider_id for item in discovered_dependencies if item.kind == DependencyKind.MCP_TOOL]
        )
        for mcp_id in mcp_ids:
            provider = db.session.scalar(
                sa.select(MCPToolProvider).where(MCPToolProvider.id == mcp_id, MCPToolProvider.tenant_id == tenant_id)
            )
            if provider is None:
                dependency_output.append({"kind": DependencyKind.UNRESOLVED, "provider_id": mcp_id, "resource": "mcp_tool"})
                report_items.append(ResourceReportItem(ResourceType.DEPENDENCY, mcp_id, None, "unresolved", "MCP provider not found"))
                continue
            if not selection.include_secrets:
                dependency_output.append({"kind": DependencyKind.MCP_TOOL, "provider_id": provider.id, "name": provider.name})
                report_items.append(ResourceReportItem(ResourceType.DEPENDENCY, provider.id, provider.name, "dependency-only"))
                continue
            provider_entity = provider.to_entity()
            output.append(
                {
                    "id": provider.id,
                    "name": provider.name,
                    "server_url": provider_entity.decrypt_server_url(),
                    "server_identifier": provider.server_identifier,
                    "headers": provider_entity.decrypt_headers(),
                    "configuration": {"timeout": provider.timeout, "sse_read_timeout": provider.sse_read_timeout},
                    "authentication": None,
                    "source_tenant_id": tenant_id,
                }
            )
            report_items.append(ResourceReportItem(ResourceType.MCP_TOOL, provider.id, provider.name, "exported"))

    def _record_dependency_metadata(
        self,
        discovered_dependencies: list[DiscoveredDependency],
        output: list[dict[str, Any]],
        report_items: list[ResourceReportItem],
    ) -> None:
        for dependency in discovered_dependencies:
            if dependency.kind != DependencyKind.BUILTIN_OR_PLUGIN_TOOL:
                continue
            output.append({"kind": dependency.kind, "provider_id": dependency.provider_id, "name": dependency.provider_name})
            report_items.append(ResourceReportItem(ResourceType.DEPENDENCY, dependency.provider_id, dependency.provider_name, "dependency-only"))

    def _get_operator_account(self, tenant_id: str) -> Account:
        account = (
            db.session.query(Account)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .filter(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == "owner")
            .order_by(TenantAccountJoin.created_at.asc())
            .first()
        )
        if account is None:
            raise MigrationDataError(f"No owner account found for tenant: {tenant_id}")
        return account

    def _unique(self, values: list[str]) -> list[str]:
        return list(dict.fromkeys(value for value in values if value))
```

- [ ] **Step 3: Run config parser tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/services/data_migration/test_export_service.py -q
uv run --project api ruff check api/services/data_migration/export_service.py api/tests/unit_tests/services/data_migration/test_export_service.py
```

Expected: tests pass. Ruff may require line wrapping; fix only the reported lines.

## Task 5: Import Service

**Files:**
- Create: `api/services/data_migration/import_service.py`
- Test: `api/tests/unit_tests/services/data_migration/test_import_service.py`

- [ ] **Step 1: Write tests for target tenant precedence and fail-fast validation**

Create `api/tests/unit_tests/services/data_migration/test_import_service.py`:

```python
import pytest

from services.data_migration.entities import MigrationDataError, MigrationPackage
from services.data_migration.import_service import ImportRequest, ImportTargetResolver


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

    assert resolver.select_target_tenant_name(
        ImportRequest(package=package, cli_target_tenant="from-cli", config_target_tenant="from-config")
    ) == "from-cli"
    assert resolver.select_target_tenant_name(
        ImportRequest(package=package, cli_target_tenant=None, config_target_tenant="from-config")
    ) == "from-config"
    assert resolver.select_target_tenant_name(
        ImportRequest(package=package, cli_target_tenant=None, config_target_tenant=None)
    ) == "from-package"


def test_target_tenant_missing_fails_before_import():
    package = MigrationPackage.from_mapping({"metadata": {"version": "1", "source_scope": "single"}})

    with pytest.raises(MigrationDataError, match="Target tenant"):
        ImportTargetResolver().select_target_tenant_name(
            ImportRequest(package=package, cli_target_tenant=None, config_target_tenant=None)
        )
```

- [ ] **Step 2: Implement import request, resolver, and service skeleton**

Create `api/services/data_migration/import_service.py`:

```python
from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models import Account, ApiToken, Tenant
from models.account import TenantAccountJoin
from models.model import App
from services.app_dsl_service import AppDslService
from services.data_migration.entities import (
    ConflictStrategy,
    ImportOptions,
    ImportResult,
    ImportTarget,
    MigrationDataError,
    MigrationPackage,
    ResourceReportItem,
    ResourceType,
)
from services.workflow_service import WorkflowService


@dataclass(frozen=True)
class ImportRequest:
    package: MigrationPackage
    cli_target_tenant: str | None = None
    config_target_tenant: str | None = None
    operator_email: str | None = None
    options_override: ImportOptions | None = None


class ImportTargetResolver:
    def select_target_tenant_name(self, request: ImportRequest) -> str:
        if request.cli_target_tenant:
            return request.cli_target_tenant
        if request.config_target_tenant:
            return request.config_target_tenant
        package_target = request.package.metadata.target_tenant or {}
        if package_target.get("name"):
            return package_target["name"]
        raise MigrationDataError("Target tenant must be provided by --target-tenant, import config, or package metadata.")

    def resolve(self, request: ImportRequest) -> ImportTarget:
        target_tenant_name = self.select_target_tenant_name(request)
        tenant = db.session.scalar(sa.select(Tenant).where(Tenant.name == target_tenant_name))
        if tenant is None:
            raise MigrationDataError(f"Target tenant not found: {target_tenant_name}")
        account_query = (
            db.session.query(Account)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .filter(TenantAccountJoin.tenant_id == tenant.id)
        )
        if request.operator_email:
            account_query = account_query.filter(Account.email == request.operator_email)
        else:
            account_query = account_query.filter(TenantAccountJoin.role == "owner").order_by(TenantAccountJoin.created_at.asc())
        account = account_query.first()
        if account is None:
            identity = request.operator_email or "owner"
            raise MigrationDataError(f"No operator account found for target tenant {target_tenant_name}: {identity}")
        return ImportTarget(
            tenant_id=tenant.id,
            tenant_name=tenant.name,
            operator_id=account.id,
            operator_email=account.email,
        )


class MigrationImportService:
    def __init__(self, *, target_resolver: ImportTargetResolver | None = None) -> None:
        self.target_resolver = target_resolver or ImportTargetResolver()

    def import_package(self, request: ImportRequest) -> ImportResult:
        target = self.target_resolver.resolve(request)
        options = request.options_override or request.package.metadata.import_options
        report_items: list[ResourceReportItem] = []
        self._import_workflows(request.package, target, options, report_items)
        self._report_dependency_only_mcp(request.package, report_items)
        return ImportResult(report_items=report_items)

    def _import_workflows(
        self,
        package: MigrationPackage,
        target: ImportTarget,
        options: ImportOptions,
        report_items: list[ResourceReportItem],
    ) -> None:
        account = db.session.get(Account, target.operator_id)
        if account is None:
            raise MigrationDataError(f"Operator account not found: {target.operator_id}")
        account.current_tenant_id = target.tenant_id
        for workflow_data in package.workflows:
            app_id = workflow_data.get("id")
            existing_app = db.session.get(App, app_id) if app_id else None
            if existing_app and options.conflict_strategy == ConflictStrategy.FAIL:
                raise MigrationDataError(f"App already exists and conflict_strategy=fail: {app_id}")
            with Session(db.engine) as session:
                import_service = AppDslService(session)
                if existing_app:
                    import_service.import_app(
                        account=account,
                        import_mode="yaml-content",
                        yaml_content=workflow_data["dsl"],
                        app_id=app_id,
                    )
                    status = "updated"
                else:
                    import_service.import_app(
                        account=account,
                        import_mode="yaml-content",
                        yaml_content=workflow_data["dsl"],
                        import_app_id=app_id,
                    )
                    status = "created"
                session.commit()
            if options.create_app_api_token_on_import and app_id:
                self._create_or_reuse_app_api_token(app_id, target.tenant_id)
            report_items.append(ResourceReportItem(ResourceType.WORKFLOW, str(app_id), workflow_data.get("name"), status))

    def _create_or_reuse_app_api_token(self, app_id: str, tenant_id: str) -> None:
        existing = db.session.scalar(sa.select(ApiToken).where(ApiToken.type == "app", ApiToken.app_id == app_id))
        if existing:
            return
        api_token = ApiToken()
        api_token.app_id = app_id
        api_token.tenant_id = tenant_id
        api_token.token = ApiToken.generate_api_key("app", 24)
        api_token.type = "app"
        db.session.add(api_token)
        db.session.commit()

    def _report_dependency_only_mcp(self, package: MigrationPackage, report_items: list[ResourceReportItem]) -> None:
        for dependency in package.dependencies:
            if dependency.get("kind") == "mcp_tool":
                report_items.append(
                    ResourceReportItem(
                        ResourceType.DEPENDENCY,
                        str(dependency.get("provider_id")),
                        dependency.get("name"),
                        "skipped",
                        "MCP provider is dependency-only; configure it manually in target tenant.",
                    )
                )
```

- [ ] **Step 3: Run import service tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/services/data_migration/test_import_service.py -q
uv run --project api ruff check api/services/data_migration/import_service.py api/tests/unit_tests/services/data_migration/test_import_service.py
```

Expected: tests pass and ruff reports no issues.

## Task 6: Report Service

**Files:**
- Create: `api/services/data_migration/report_service.py`
- Test: `api/tests/unit_tests/services/data_migration/test_report_service.py`

- [ ] **Step 1: Write tests for summarized counts**

Create `api/tests/unit_tests/services/data_migration/test_report_service.py`:

```python
from services.data_migration.entities import ResourceReportItem, ResourceType
from services.data_migration.report_service import MigrationReportService


def test_report_summarizes_by_resource_type_and_status():
    lines = MigrationReportService().render(
        [
            ResourceReportItem(ResourceType.WORKFLOW, "app-1", "App", "exported"),
            ResourceReportItem(ResourceType.API_TOOL, "weather", "Weather", "exported"),
            ResourceReportItem(ResourceType.DEPENDENCY, "mcp-1", "MCP", "dependency-only"),
        ]
    )

    assert "workflow exported: 1" in lines
    assert "api_tool exported: 1" in lines
    assert "dependency dependency-only: 1" in lines
```

- [ ] **Step 2: Implement report rendering**

Create `api/services/data_migration/report_service.py`:

```python
from __future__ import annotations

from collections import Counter

from services.data_migration.entities import ResourceReportItem


class MigrationReportService:
    def render(self, items: list[ResourceReportItem]) -> list[str]:
        counts = Counter((item.resource_type.value, item.status) for item in items)
        lines = [f"{resource_type} {status}: {count}" for (resource_type, status), count in sorted(counts.items())]
        unresolved = [item for item in items if item.status in {"unresolved", "skipped"} and item.message]
        for item in unresolved:
            lines.append(f"{item.resource_type.value} {item.identifier}: {item.message}")
        return lines
```

- [ ] **Step 3: Run report tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/services/data_migration/test_report_service.py -q
uv run --project api ruff check api/services/data_migration/report_service.py api/tests/unit_tests/services/data_migration/test_report_service.py
```

Expected: tests pass.

## Task 7: Thin Click Commands

**Files:**
- Create: `api/commands/data_migration.py`
- Modify: `api/commands/system.py`
- Modify: `api/commands/__init__.py`
- Modify: `api/extensions/ext_commands.py`
- Test: `api/tests/unit_tests/commands/test_data_migration_commands.py`

- [ ] **Step 1: Write command tests for names and options**

Create `api/tests/unit_tests/commands/test_data_migration_commands.py`:

```python
from click.testing import CliRunner

from commands.data_migration import export_migration_data, import_migration_data


def test_export_command_requires_input_and_output():
    result = CliRunner().invoke(export_migration_data, [])

    assert result.exit_code != 0
    assert "--input" in result.output
    assert "--output" in result.output


def test_import_command_requires_input_and_target_tenant_or_package_metadata():
    result = CliRunner().invoke(import_migration_data, [])

    assert result.exit_code != 0
    assert "--input" in result.output
```

- [ ] **Step 2: Implement command module**

Create `api/commands/data_migration.py`:

```python
from __future__ import annotations

import json
from pathlib import Path

import click

from services.data_migration.entities import ImportOptions, MigrationDataError
from services.data_migration.export_service import ExportConfigParser, MigrationExportService
from services.data_migration.import_service import ImportRequest, MigrationImportService
from services.data_migration.package_service import MigrationPackageService
from services.data_migration.report_service import MigrationReportService


@click.command("export-migration-data", help="Export workflow migration data to a versioned JSON package.")
@click.option("--input", "input_file", required=True, type=click.Path(exists=True, dir_okay=False), help="Path to export config JSON.")
@click.option("--output", "output_file", required=True, type=click.Path(dir_okay=False), help="Path to migration package JSON.")
@click.option("--overwrite", is_flag=True, default=False, help="Overwrite output if it already exists.")
def export_migration_data(input_file: str, output_file: str, overwrite: bool) -> None:
    try:
        with Path(input_file).open(encoding="utf-8") as file:
            raw_config = json.load(file)
        selection = ExportConfigParser().parse(raw_config)
        result = MigrationExportService().export(selection)
        MigrationPackageService().save_package(result.package, output_file, overwrite=overwrite)
        click.echo(click.style(f"Output written to {output_file}", fg="green"))
        for line in MigrationReportService().render(result.report_items):
            click.echo(line)
    except MigrationDataError as exc:
        raise click.ClickException(str(exc)) from exc


@click.command("import-migration-data", help="Import a versioned migration data package.")
@click.option("--input", "input_file", required=True, type=click.Path(exists=True, dir_okay=False), help="Path to migration package JSON.")
@click.option("--target-tenant", default=None, help="Target tenant/workspace name. Overrides package metadata.")
@click.option("--operator-email", default=None, help="Operator account email in the target tenant.")
@click.option("--id-strategy", default=None, type=click.Choice(["preserve-id", "generate-new-id", "map-id"]), help="Override package ID strategy.")
@click.option("--conflict-strategy", default=None, type=click.Choice(["fail", "skip", "update", "replace"]), help="Override package conflict strategy.")
@click.option("--create-app-api-token-on-import/--no-create-app-api-token-on-import", default=None, help="Override package app API token creation behavior.")
def import_migration_data(
    input_file: str,
    target_tenant: str | None,
    operator_email: str | None,
    id_strategy: str | None,
    conflict_strategy: str | None,
    create_app_api_token_on_import: bool | None,
) -> None:
    try:
        package_service = MigrationPackageService()
        package = package_service.load_package(input_file)
        options_override = None
        if id_strategy or conflict_strategy or create_app_api_token_on_import is not None:
            merged = {
                "id_strategy": id_strategy or package.metadata.import_options.id_strategy,
                "conflict_strategy": conflict_strategy or package.metadata.import_options.conflict_strategy,
                "create_app_api_token_on_import": (
                    create_app_api_token_on_import
                    if create_app_api_token_on_import is not None
                    else package.metadata.import_options.create_app_api_token_on_import
                ),
            }
            options_override = ImportOptions.from_mapping(merged)
        result = MigrationImportService().import_package(
            ImportRequest(
                package=package,
                cli_target_tenant=target_tenant,
                operator_email=operator_email,
                options_override=options_override,
            )
        )
        for line in MigrationReportService().render(result.report_items):
            click.echo(line)
    except MigrationDataError as exc:
        raise click.ClickException(str(exc)) from exc
```

- [ ] **Step 3: Move old command exports and registrations**

Modify `api/commands/__init__.py` so it imports and exports `export_migration_data`, `import_migration_data`, and `migration_data_wizard` from `api/commands/data_migration.py`, and removes `export_custom_data`, `import_custom_data`, and `migration_custom_datas`.

Modify `api/extensions/ext_commands.py` so `init_app` registers the three new commands and no longer registers the draft names.

Modify `api/commands/system.py` by deleting `_do_export_custom_data`, `_do_import_custom_data`, `export_custom_data`, `import_custom_data`, and `migration_custom_datas`.

- [ ] **Step 4: Run command tests and inspect command list**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/commands/test_data_migration_commands.py -q
uv run --project api ruff check api/commands/data_migration.py api/commands/__init__.py api/extensions/ext_commands.py api/tests/unit_tests/commands/test_data_migration_commands.py
```

Expected: tests pass and ruff reports no issues.

## Task 8: Export Wizard

**Files:**
- Modify: `api/commands/data_migration.py`
- Test: `api/tests/unit_tests/commands/test_data_migration_wizard.py`

- [ ] **Step 1: Add wizard helper tests**

Create `api/tests/unit_tests/commands/test_data_migration_wizard.py`:

```python
from commands.data_migration import parse_index_selection


def test_parse_index_selection_supports_all():
    assert parse_index_selection("all", ["a", "b", "c"]) == ["a", "b", "c"]


def test_parse_index_selection_supports_comma_indexes():
    assert parse_index_selection("1, 3", ["a", "b", "c"]) == ["a", "c"]
```

- [ ] **Step 2: Add helper functions and wizard command**

Append to `api/commands/data_migration.py`:

```python
import sqlalchemy as sa

from extensions.ext_database import db
from models import Tenant
from models.model import App


def parse_index_selection(raw: str, values: list[str]) -> list[str]:
    normalized = raw.strip().lower()
    if normalized == "all":
        return values
    selected: list[str] = []
    for part in raw.split(","):
        index = int(part.strip())
        if index < 1 or index > len(values):
            raise click.ClickException(f"Selection index out of range: {index}")
        selected.append(values[index - 1])
    return list(dict.fromkeys(selected))


@click.command("migration-data-wizard", help="Interactively export workflow migration data.")
def migration_data_wizard() -> None:
    try:
        tenants = list(db.session.scalars(sa.select(Tenant).order_by(Tenant.name.asc())).all())
        if not tenants:
            raise MigrationDataError("No tenants found.")
        click.echo("Source tenants:")
        for idx, tenant in enumerate(tenants, 1):
            click.echo(f"{idx}. {tenant.name} ({tenant.id})")
        tenant_index = click.prompt("Select one source tenant", type=int)
        if tenant_index < 1 or tenant_index > len(tenants):
            raise click.ClickException(f"Selection index out of range: {tenant_index}")
        tenant = tenants[tenant_index - 1]

        apps = list(
            db.session.scalars(
                sa.select(App)
                .where(App.tenant_id == tenant.id, App.mode.in_(["workflow", "advanced-chat"]))
                .order_by(App.name.asc())
            ).all()
        )
        click.echo("Workflow/chatflow apps:")
        for idx, app in enumerate(apps, 1):
            click.echo(f"{idx}. {app.name} [{app.mode}] ({app.id})")
        app_ids = parse_index_selection(click.prompt("Select apps by number, or all", default="all"), [app.id for app in apps])

        include_referenced_tools = click.confirm("Automatically export tools referenced by selected apps?", default=True)
        include_secrets = click.confirm("Include secrets in output JSON? The file will contain sensitive data.", default=False)
        create_tokens = click.confirm("Create or reuse app API tokens during import?", default=False)
        default_output = "migration-data.json"
        output_file = click.prompt("Output path", default=default_output)
        overwrite = False
        if Path(output_file).exists():
            overwrite = click.confirm("Output file exists. Overwrite?", default=False)
            if not overwrite:
                raise click.ClickException(f"Output file already exists: {output_file}")

        selection = ExportConfigParser().parse(
            {
                "source_tenant": {"mode": "single", "name": tenant.name},
                "apps": {"ids": app_ids, "all": False},
                "include_referenced_tools": include_referenced_tools,
                "include_secrets": include_secrets,
                "import_options": {"create_app_api_token_on_import": create_tokens},
            }
        )
        result = MigrationExportService().export(selection)
        MigrationPackageService().save_package(result.package, output_file, overwrite=overwrite)
        click.echo(click.style(f"Output written to {output_file}", fg="green"))
        for line in MigrationReportService().render(result.report_items):
            click.echo(line)
    except MigrationDataError as exc:
        raise click.ClickException(str(exc)) from exc
```

Ensure imports are de-duplicated and sorted by ruff.

- [ ] **Step 3: Run wizard helper tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/commands/test_data_migration_wizard.py -q
uv run --project api ruff check api/commands/data_migration.py api/tests/unit_tests/commands/test_data_migration_wizard.py
```

Expected: tests pass.

## Task 9: Integration Polish And Full Verification

**Files:**
- Modify as needed based on ruff/test failures.
- Review: `docs/superpowers/specs/2026-05-27-cross-env-data-migration-wizard-spec.md`

- [ ] **Step 1: Run all focused tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/services/data_migration \
  api/tests/unit_tests/commands/test_data_migration_commands.py \
  api/tests/unit_tests/commands/test_data_migration_wizard.py \
  -q
```

Expected: all focused tests pass.

- [ ] **Step 2: Run lint on touched code**

Run:

```bash
uv run --project api ruff check \
  api/services/data_migration \
  api/commands/data_migration.py \
  api/commands/__init__.py \
  api/extensions/ext_commands.py \
  api/tests/unit_tests/services/data_migration \
  api/tests/unit_tests/commands/test_data_migration_commands.py \
  api/tests/unit_tests/commands/test_data_migration_wizard.py
```

Expected: no ruff errors.

- [ ] **Step 3: Check command registration manually**

Run:

```bash
uv run --project api flask --help | rg "migration-data|custom-data|migration-custom"
```

Expected:

```text
export-migration-data
import-migration-data
migration-data-wizard
```

The old draft names should not appear.

- [ ] **Step 4: Search for stale draft names**

Run:

```bash
rg "export-custom-data|import-custom-data|migration-custom-datas|workflow_publish_api|publish_api" api/commands api/services/data_migration api/tests/unit_tests
```

Expected: no references in new migration command/service code. Existing unrelated code can remain only if it is outside the new migration-data implementation.

- [ ] **Step 5: Self-review against spec**

Check:
- migration package includes `metadata.version`, `source_tenants`, `include_secrets`, `import_options`, and `dependencies`.
- scripted export uses `source_tenant`, `apps`, `include_referenced_tools`, `additional_tools`, `include_secrets`, and `import_options`.
- import target is resolved once, before writes.
- wizard is single-source-tenant only.
- wizard output path has a default and asks before overwrite.
- API token option is named `create_app_api_token_on_import`.
- MCP secret-free export is dependency-only.
- workflow tool import does not silently create broken references; unresolved cases are reported or skipped.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add api/services/data_migration api/commands/data_migration.py api/commands/__init__.py api/extensions/ext_commands.py api/commands/system.py api/tests/unit_tests/services/data_migration api/tests/unit_tests/commands/test_data_migration_commands.py api/tests/unit_tests/commands/test_data_migration_wizard.py docs/superpowers/plans/2026-05-27-cross-env-data-migration-wizard-plan.md
git commit -m "refactor: add migration data service layer and wizard"
```

Expected: one commit containing only migration feature implementation and plan changes. Do not stage local dev setup files (`Makefile`, `docker/ssrf_proxy/squid.conf.template`) or `.testcli/`.

## Subagent Execution Notes

- Use separate workers for non-overlapping write sets:
  - Worker A: `entities.py`, `package_service.py`, entity/package tests.
  - Worker B: `dependency_discovery_service.py`, discovery tests.
  - Worker C: `report_service.py`, report tests.
  - Worker D: `export_service.py`, export tests.
  - Worker E: `import_service.py`, import tests.
  - Worker F: `api/commands/data_migration.py`, command registration, command tests.
- Tell every worker the repo may have unrelated local changes and they must not revert them.
- After each worker, run a spec-compliance review subagent followed by a code-quality review subagent before marking that task complete.
- Do not let multiple workers edit `api/commands/data_migration.py` at the same time.
- Keep service APIs free of `click.echo`; only command adapters print.
