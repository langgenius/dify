from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import click
import sqlalchemy as sa
import yaml

from extensions.ext_database import db
from models import Tenant
from models.model import App
from models.tools import ApiToolProvider, MCPToolProvider, WorkflowToolProvider
from services.app_dsl_service import AppDslService
from services.data_migration.dependency_discovery_service import DependencyDiscoveryService
from services.data_migration.entities import (
    DependencyKind,
    ImportOptions,
    MigrationDataError,
    ReportContext,
    ResourceReportItem,
)
from services.data_migration.export_service import ExportConfigParser, MigrationExportService
from services.data_migration.import_service import ImportRequest, MigrationImportService
from services.data_migration.package_service import MigrationPackageService
from services.data_migration.report_service import MigrationReportService

ID_STRATEGY_CHOICES = ["preserve-id", "generate-new-id", "map-id"]
CONFLICT_STRATEGY_CHOICES = ["fail", "skip", "update", "replace"]
SUPPORTED_WIZARD_APP_MODES = ["workflow", "advanced-chat"]


@click.command("export-migration-data", help="Export workflow migration data to a versioned JSON package.")
@click.option(
    "--input",
    "input_file",
    required=False,
    type=click.Path(exists=True, dir_okay=False),
    help="Path to export config JSON.",
)
@click.option(
    "--output",
    "output_file",
    required=False,
    type=click.Path(dir_okay=False),
    help="Path to migration package JSON.",
)
@click.option("--overwrite", is_flag=True, default=False, help="Overwrite output if it already exists.")
def export_migration_data(input_file: str | None, output_file: str | None, overwrite: bool) -> None:
    try:
        _require_options(("--input", input_file), ("--output", output_file))
        assert input_file is not None
        assert output_file is not None
        raw_config = _load_json_object(input_file, "Export config")
        selection = ExportConfigParser().parse(raw_config)
        result = MigrationExportService().export(selection)
        MigrationPackageService().save_package(result.package, output_file, overwrite=overwrite)
        click.echo(click.style(f"Output written to {output_file}", fg="green"))
        _render_report(result.report_items, context=_with_output_path(result.report_context, output_file))
    except MigrationDataError as exc:
        raise click.ClickException(str(exc)) from exc


@click.command("import-migration-data", help="Import a versioned migration data package.")
@click.option(
    "--input",
    "input_file",
    required=False,
    type=click.Path(exists=True, dir_okay=False),
    help="Path to migration package JSON.",
)
@click.option("--target-tenant", default=None, help="Target tenant/workspace name. Overrides package metadata.")
@click.option("--operator-email", default=None, help="Operator account email in the target tenant.")
@click.option(
    "--id-strategy",
    default=None,
    type=click.Choice(ID_STRATEGY_CHOICES),
    help="Override package ID strategy.",
)
@click.option(
    "--conflict-strategy",
    default=None,
    type=click.Choice(CONFLICT_STRATEGY_CHOICES),
    help="Override package conflict strategy.",
)
@click.option(
    "--create-app-api-token-on-import/--no-create-app-api-token-on-import",
    default=None,
    help="Override package app API token creation behavior.",
)
def import_migration_data(
    input_file: str | None,
    target_tenant: str | None,
    operator_email: str | None,
    id_strategy: str | None,
    conflict_strategy: str | None,
    create_app_api_token_on_import: bool | None,
) -> None:
    try:
        _require_options(("--input", input_file))
        assert input_file is not None
        package = MigrationPackageService().load_package(input_file)
        result = MigrationImportService().import_package(
            ImportRequest(
                package=package,
                cli_target_tenant=target_tenant,
                operator_email=operator_email,
                options_override=_build_options_override(
                    package.metadata.import_options,
                    id_strategy=id_strategy,
                    conflict_strategy=conflict_strategy,
                    create_app_api_token_on_import=create_app_api_token_on_import,
                ),
            )
        )
        _render_report(result.report_items, context=result.report_context)
    except MigrationDataError as exc:
        raise click.ClickException(str(exc)) from exc


def parse_index_selection(raw: str, values: list[str]) -> list[str]:
    normalized = raw.strip().lower()
    if normalized == "all":
        return values

    selected: list[str] = []
    for part in raw.split(","):
        stripped = part.strip()
        if not stripped:
            continue
        try:
            index = int(stripped)
        except ValueError as exc:
            raise click.ClickException(f"Selection must be 'all' or comma-separated numbers: {raw}") from exc
        if index < 1 or index > len(values):
            raise click.ClickException(f"Selection index out of range: {index}")
        selected.append(values[index - 1])
    return list(dict.fromkeys(selected))


@click.command("migration-data-wizard", help="Interactively export workflow migration data.")
def migration_data_wizard() -> None:
    try:
        tenant = _prompt_source_tenant()
        apps = _eligible_apps_for_tenant(tenant.id)
        app_ids = _prompt_app_ids(apps)
        include_referenced_tools = click.confirm(
            "Automatically export tools referenced by selected apps?",
            default=True,
        )
        auto_tools = _discover_auto_tools([app for app in apps if app.id in set(app_ids)], include_referenced_tools)
        additional_tools = _prompt_additional_tools(tenant.id, auto_tools)
        include_secrets = click.confirm(
            "Include secrets in output JSON? The file will contain sensitive data.",
            default=False,
        )
        create_tokens = click.confirm("Create or reuse app API tokens during import?", default=False)
        output_file, overwrite = _prompt_output_file()

        selection = ExportConfigParser().parse(
            {
                "source_tenant": {"mode": "single", "id": tenant.id, "name": tenant.name},
                "apps": {"ids": app_ids, "all": False},
                "include_referenced_tools": include_referenced_tools,
                "additional_tools": additional_tools,
                "include_secrets": include_secrets,
                "import_options": {"create_app_api_token_on_import": create_tokens},
            }
        )
        _confirm_wizard_summary(
            tenant_name=tenant.name,
            app_count=len(app_ids),
            additional_tools=additional_tools,
            include_referenced_tools=include_referenced_tools,
            include_secrets=include_secrets,
            create_tokens=create_tokens,
            output_file=output_file,
        )
        result = MigrationExportService().export(selection)
        MigrationPackageService().save_package(result.package, output_file, overwrite=overwrite)
        click.echo(click.style(f"Output written to {output_file}", fg="green"))
        _render_report(result.report_items, context=_with_output_path(result.report_context, output_file))
    except MigrationDataError as exc:
        raise click.ClickException(str(exc)) from exc


def _load_json_object(path: str, label: str) -> dict[str, Any]:
    try:
        with Path(path).open(encoding="utf-8") as file:
            raw = json.load(file)
    except json.JSONDecodeError as exc:
        raise MigrationDataError(f"{label} JSON is invalid: {exc.msg}") from exc
    if not isinstance(raw, dict):
        raise MigrationDataError(f"{label} JSON must be an object.")
    return raw


def _require_options(*options: tuple[str, object | None]) -> None:
    missing_options = [name for name, value in options if value is None]
    if missing_options:
        raise click.UsageError(f"Missing option(s): {', '.join(missing_options)}.")


def _build_options_override(
    package_options: ImportOptions,
    *,
    id_strategy: str | None,
    conflict_strategy: str | None,
    create_app_api_token_on_import: bool | None,
) -> ImportOptions | None:
    if id_strategy is None and conflict_strategy is None and create_app_api_token_on_import is None:
        return None
    return ImportOptions.from_mapping(
        {
            "id_strategy": id_strategy or package_options.id_strategy,
            "conflict_strategy": conflict_strategy or package_options.conflict_strategy,
            "create_app_api_token_on_import": (
                create_app_api_token_on_import
                if create_app_api_token_on_import is not None
                else package_options.create_app_api_token_on_import
            ),
        }
    )


def _prompt_source_tenant() -> Tenant:
    tenants = list(db.session.scalars(sa.select(Tenant).order_by(Tenant.name.asc())).all())
    if not tenants:
        raise MigrationDataError("No tenants found.")

    click.echo("Source tenants:")
    for index, tenant in enumerate(tenants, 1):
        click.echo(f"{index}. {tenant.name} ({tenant.id})")

    tenant_index = click.prompt("Select one source tenant", type=int)
    if tenant_index < 1 or tenant_index > len(tenants):
        raise click.ClickException(f"Selection index out of range: {tenant_index}")
    return tenants[tenant_index - 1]


def _eligible_apps_for_tenant(tenant_id: str) -> list[App]:
    return list(
        db.session.scalars(
            sa.select(App)
            .where(App.tenant_id == tenant_id, App.mode.in_(SUPPORTED_WIZARD_APP_MODES))
            .order_by(App.name.asc())
        ).all()
    )


def _prompt_app_ids(apps: list[App]) -> list[str]:
    if not apps:
        raise MigrationDataError("No workflow or advanced-chat apps found for the selected tenant.")

    click.echo("Workflow/chatflow apps:")
    for index, app in enumerate(apps, 1):
        mode = app.mode.value if hasattr(app.mode, "value") else app.mode
        click.echo(f"{index}. {app.name} [{mode}] ({app.id})")
    return parse_index_selection(click.prompt("Select apps by number, or all", default="all"), [app.id for app in apps])


def _discover_auto_tools(apps: list[App], include_referenced_tools: bool) -> dict[str, set[str]]:
    auto_tools = {"api_tools": set(), "workflow_tools": set(), "mcp_tools": set()}
    if not include_referenced_tools:
        return auto_tools
    discovery_service = DependencyDiscoveryService()
    for app in apps:
        dsl_content = AppDslService.export_dsl(app_model=app, include_secret=False)
        raw_dsl = yaml.safe_load(dsl_content) if dsl_content else {}
        dsl = raw_dsl if isinstance(raw_dsl, dict) else {}
        for dependency in discovery_service.discover_from_dsl(dsl):
            if dependency.kind == DependencyKind.API_TOOL:
                auto_tools["api_tools"].add(dependency.provider_id)
                if dependency.provider_name:
                    auto_tools["api_tools"].add(dependency.provider_name)
            elif dependency.kind == DependencyKind.WORKFLOW_TOOL:
                auto_tools["workflow_tools"].add(dependency.provider_id)
                if dependency.provider_name:
                    auto_tools["workflow_tools"].add(dependency.provider_name)
            elif dependency.kind == DependencyKind.MCP_TOOL:
                auto_tools["mcp_tools"].add(dependency.provider_id)
                if dependency.provider_name:
                    auto_tools["mcp_tools"].add(dependency.provider_name)
    return auto_tools


def _prompt_additional_tools(tenant_id: str, auto_tools: dict[str, set[str]]) -> dict[str, list[str]]:
    selections = {"api_tools": [], "workflow_tools": [], "mcp_tools": []}
    if not click.confirm("Export additional tools manually?", default=False):
        return selections
    selections["api_tools"] = _prompt_tool_category(
        "Custom API tools",
        [
            (tool.name, tool.name, tool.id)
            for tool in db.session.scalars(
                sa.select(ApiToolProvider).where(ApiToolProvider.tenant_id == tenant_id).order_by(ApiToolProvider.name)
            ).all()
        ],
        auto_values=auto_tools["api_tools"],
    )
    selections["workflow_tools"] = _prompt_tool_category(
        "Workflow tools",
        [
            (tool.id, tool.name, tool.app_id)
            for tool in db.session.scalars(
                sa.select(WorkflowToolProvider)
                .where(WorkflowToolProvider.tenant_id == tenant_id)
                .order_by(WorkflowToolProvider.name)
            ).all()
        ],
        auto_values=auto_tools["workflow_tools"],
    )
    selections["mcp_tools"] = _prompt_tool_category(
        "MCP tools",
        [
            (tool.id, tool.name, tool.server_identifier)
            for tool in db.session.scalars(
                sa.select(MCPToolProvider).where(MCPToolProvider.tenant_id == tenant_id).order_by(MCPToolProvider.name)
            ).all()
        ],
        auto_values=auto_tools["mcp_tools"],
    )
    return selections


def _prompt_tool_category(label: str, options: list[tuple[str, str, str]], *, auto_values: set[str]) -> list[str]:
    if not options:
        click.echo(f"{label}: none")
        return []
    click.echo(label)
    for index, (value, name, detail) in enumerate(options, 1):
        marker = "[auto]" if value in auto_values or detail in auto_values else "[ ]"
        click.echo(f"{index}. {marker} {name} ({detail})")
    raw = click.prompt(f"Select {label.lower()} by number, all, or empty", default="", show_default=False)
    if not raw.strip():
        return []
    return parse_index_selection(raw, [value for value, _, _ in options])


def _confirm_wizard_summary(
    *,
    tenant_name: str,
    app_count: int,
    additional_tools: dict[str, list[str]],
    include_referenced_tools: bool,
    include_secrets: bool,
    create_tokens: bool,
    output_file: str,
) -> None:
    click.echo("Migration export summary:")
    click.echo(f"source tenant: {tenant_name}")
    click.echo(f"selected apps: {app_count}")
    click.echo(f"auto referenced tools: {str(include_referenced_tools).lower()}")
    click.echo(f"additional api tools: {len(additional_tools['api_tools'])}")
    click.echo(f"additional workflow tools: {len(additional_tools['workflow_tools'])}")
    click.echo(f"additional mcp tools: {len(additional_tools['mcp_tools'])}")
    click.echo(f"include secrets: {str(include_secrets).lower()}")
    click.echo(f"create app api token on import: {str(create_tokens).lower()}")
    click.echo(f"output path: {output_file}")
    if not click.confirm("Write migration package?", default=True):
        raise click.Abort()


def _prompt_output_file() -> tuple[str, bool]:
    default_output = f"migration-data-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    output_file = click.prompt("Output path", default=default_output)
    overwrite = False
    if Path(output_file).exists():
        overwrite = click.confirm("Output file exists. Overwrite?", default=False)
        if not overwrite:
            raise click.ClickException(f"Output file already exists: {output_file}")
    return output_file, overwrite


def _with_output_path(context: ReportContext | None, output_path: str) -> ReportContext:
    if context is None:
        return ReportContext(output_path=output_path)
    return ReportContext(
        output_path=output_path,
        source_scope=context.source_scope,
        selected_app_count=context.selected_app_count,
        include_secrets=context.include_secrets,
        target_tenant=context.target_tenant,
        operator_email=context.operator_email,
        app_api_tokens_created=context.app_api_tokens_created,
        app_api_tokens_reused=context.app_api_tokens_reused,
        id_mapping_count=context.id_mapping_count,
    )


def _render_report(report_items: list[ResourceReportItem], *, context: ReportContext | None = None) -> None:
    for line in MigrationReportService().render(report_items, context=context):
        click.echo(line)
