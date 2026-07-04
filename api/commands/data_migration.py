from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, cast
from uuid import UUID

import click
import sqlalchemy as sa
import yaml

from core.db.session_factory import session_factory
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

ID_STRATEGY_CHOICES = ["preserve-id", "generate-new-id"]
CONFLICT_STRATEGY_CHOICES = ["fail", "skip", "update"]
SUPPORTED_WIZARD_APP_MODES = ["workflow", "advanced-chat"]
WizardToolMap = dict[str, dict[str, str | None]]
WizardToolSelection = dict[str, list[str]]


def _scripted_export_template() -> dict[str, Any]:
    return {
        "source_tenant": {
            "mode": "single",
            "id": "",
            "name": "admin's Workspace",
        },
        "apps": {
            "modes": ["workflow", "advanced-chat"],
            "ids": [],
            "all": True,
        },
        "include_referenced_tools": True,
        "additional_tools": {
            "api_tools": [],
            "workflow_tools": [],
            "mcp_tools": [],
        },
        "include_secrets": False,
        "import_options": {
            "create_app_api_token_on_import": False,
            "id_strategy": "preserve-id",
            "conflict_strategy": "fail",
        },
    }


@click.command("app-migration-template", help="Print or write a scripted export config JSON template.")
@click.option(
    "--output",
    "output_file",
    required=False,
    type=click.Path(dir_okay=False),
    help="Path to write the export config JSON template. Prints to stdout when omitted.",
)
@click.option("--overwrite", is_flag=True, default=False, help="Overwrite output if it already exists.")
def export_migration_data_template(output_file: str | None, overwrite: bool) -> None:
    template_json = json.dumps(_scripted_export_template(), indent=2, ensure_ascii=False) + "\n"
    if output_file is None:
        click.echo(template_json, nl=False)
        return
    path = Path(output_file)
    if path.exists() and not overwrite:
        raise click.ClickException(f"Output file already exists: {output_file}")
    path.write_text(template_json)
    click.echo(click.style(f"Output written to {output_file}", fg="green"))


@click.command("export-app-migration", help="Export workflow migration data to a versioned JSON package.")
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
        with session_factory.create_session() as session:
            result = MigrationExportService().export(session, selection)
        MigrationPackageService().save_package(result.package, output_file, overwrite=overwrite)
        click.echo(click.style(f"Output written to {output_file}", fg="green"))
        _render_report(result.report_items, context=_with_output_path(result.report_context, output_file))
    except MigrationDataError as exc:
        raise click.ClickException(str(exc)) from exc


@click.command("import-app-migration", help="Import a versioned migration data package.")
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
        with session_factory.create_session() as session:
            result = MigrationImportService().import_package(
                session,
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
                ),
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


def _print_wizard_step(title: str) -> None:
    click.echo("")
    click.echo(f"==== {title} ====")


def _print_wizard_substep(title: str) -> None:
    click.echo("")
    click.echo(f"-- {title} --")


@click.command("app-migration-wizard", help="Interactively export workflow migration data.")
def migration_data_wizard() -> None:
    try:
        tenant = _prompt_source_tenant()
        apps = _eligible_apps_for_tenant(tenant.id)
        app_ids = _prompt_app_ids(apps)
        _print_wizard_step("Referenced Tools")
        include_referenced_tools = click.confirm(
            "Automatically export tools referenced by selected apps? [y/n, default: y]",
            default=True,
            show_default=False,
        )
        auto_tools = _discover_auto_tools([app for app in apps if app.id in set(app_ids)], include_referenced_tools)
        auto_tools = _resolve_auto_tool_names(tenant.id, auto_tools)
        _print_auto_tools(auto_tools)
        additional_tools = _prompt_additional_tools(tenant.id, auto_tools)
        include_secrets, create_tokens, id_strategy, conflict_strategy = _prompt_import_options()
        _print_wizard_step("Output")
        output_file, overwrite = _prompt_output_file()

        selection = ExportConfigParser().parse(
            {
                "source_tenant": {"mode": "single", "id": tenant.id, "name": tenant.name},
                "apps": {"ids": app_ids, "all": False},
                "include_referenced_tools": include_referenced_tools,
                "additional_tools": additional_tools,
                "include_secrets": include_secrets,
                "import_options": {
                    "create_app_api_token_on_import": create_tokens,
                    "id_strategy": id_strategy,
                    "conflict_strategy": conflict_strategy,
                },
            }
        )
        _confirm_wizard_summary(
            tenant_name=tenant.name,
            app_names=[app.name for app in apps if app.id in set(app_ids)],
            auto_tools=auto_tools,
            additional_tools=additional_tools,
            manual_labels=_selected_tool_labels_for_tenant(tenant.id, additional_tools),
            include_referenced_tools=include_referenced_tools,
            include_secrets=include_secrets,
            create_tokens=create_tokens,
            id_strategy=id_strategy,
            conflict_strategy=conflict_strategy,
            output_file=output_file,
        )
        with session_factory.create_session() as session:
            result = MigrationExportService().export(session, selection)
        MigrationPackageService().save_package(result.package, output_file, overwrite=overwrite)
        click.echo(click.style(f"Output written to {output_file}", fg="green"))
        _print_wizard_step("Report")
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

    _print_wizard_step("Source Tenant")
    click.echo("Source tenants:")
    for index, tenant in enumerate(tenants, 1):
        click.echo(f"{index}. {tenant.name} ({tenant.id})")

    tenant_index = click.prompt("Select one source tenant by number", type=int, default=1, show_default=True)
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

    _print_wizard_step("App Selection")
    click.echo("Currently supported app types: workflow and chatflow.")
    click.echo("Workflow/chatflow apps:")
    for index, app in enumerate(apps, 1):
        mode = app.mode.value if hasattr(app.mode, "value") else app.mode
        click.echo(f"{index}. {app.name} [{mode}] ({app.id})")
    app_ids = parse_index_selection(
        click.prompt("Select apps by number, comma-separated numbers, or all", default="all"),
        [app.id for app in apps],
    )
    selected_apps = [app for app in apps if app.id in set(app_ids)]
    click.echo("Selected apps:")
    for app in selected_apps:
        click.echo(f"- {app.name} ({app.id})")
    return app_ids


def _prompt_import_options() -> tuple[bool, bool, str, str]:
    _print_wizard_step("Import Options")
    _print_wizard_substep("Secrets")
    click.echo("Secrets include workflow/app DSL secret values, custom API tool credentials,")
    click.echo("and full MCP provider connection data such as server URL, headers, authentication, and tool list.")
    click.echo("If you choose no, credentials are omitted or masked,")
    click.echo("and MCP providers are exported as dependency metadata only.")
    click.echo("Treat the output JSON as sensitive if you choose yes.")
    include_secrets = click.confirm(
        "Include secrets in output JSON? [y/n, default: n]",
        default=False,
        show_default=False,
    )
    _print_wizard_substep("App API Tokens")
    click.echo("When enabled, import will create an app API token if the imported app has none,")
    click.echo("or reuse an existing app API token if one already exists.")
    create_tokens = click.confirm(
        "Create or reuse app API tokens during import? [y/n, default: n]",
        default=False,
        show_default=False,
    )
    _print_wizard_substep("ID Strategy")
    click.echo("ID strategy controls whether imported app and tool IDs preserve source IDs")
    click.echo("or use target-generated IDs.")
    click.echo("preserve-id: keep source IDs where the target service supports it.")
    click.echo("generate-new-id: let the target environment generate new IDs and rewrite references via mapping.")
    id_strategy = click.prompt(
        "Import ID strategy. Enter one of: preserve-id, generate-new-id",
        type=click.Choice(ID_STRATEGY_CHOICES),
        default="preserve-id",
        show_default=True,
    )
    _print_wizard_substep("Conflict Strategy")
    click.echo("Conflict strategy controls what import does when a target resource already exists.")
    click.echo("fail: stop at the first conflict; previously committed resources are not rolled back.")
    click.echo("skip: keep the existing target resource and skip importing that resource.")
    click.echo("update: update the existing target resource in place.")
    conflict_strategy = click.prompt(
        "Import conflict strategy. Enter one of: fail, skip, update",
        type=click.Choice(CONFLICT_STRATEGY_CHOICES),
        default="update",
        show_default=True,
    )
    return include_secrets, create_tokens, id_strategy, conflict_strategy


def _discover_auto_tools(apps: list[App], include_referenced_tools: bool) -> WizardToolMap:
    auto_tools: WizardToolMap = {"api_tools": {}, "workflow_tools": {}, "mcp_tools": {}}
    if not include_referenced_tools:
        return auto_tools
    discovery_service = DependencyDiscoveryService()
    for app in apps:
        dsl_content = AppDslService.export_dsl(app_model=app, include_secret=False)
        raw_dsl = yaml.safe_load(dsl_content) if dsl_content else {}
        dsl = raw_dsl if isinstance(raw_dsl, dict) else {}
        for dependency in discovery_service.discover_from_dsl(dsl):
            if dependency.kind == DependencyKind.API_TOOL:
                auto_tools["api_tools"][dependency.provider_name or dependency.provider_id] = dependency.provider_id
            elif dependency.kind == DependencyKind.WORKFLOW_TOOL:
                auto_tools["workflow_tools"][dependency.provider_name or dependency.provider_id] = (
                    dependency.provider_id
                )
            elif dependency.kind == DependencyKind.MCP_TOOL:
                auto_tools["mcp_tools"][dependency.provider_name or dependency.provider_id] = dependency.provider_id
    return auto_tools


def _resolve_auto_tool_names(tenant_id: str, auto_tools: WizardToolMap) -> WizardToolMap:
    return {
        "api_tools": _resolve_api_tool_names(tenant_id, auto_tools["api_tools"]),
        "workflow_tools": _resolve_workflow_tool_names(tenant_id, auto_tools["workflow_tools"]),
        "mcp_tools": _resolve_mcp_tool_names(tenant_id, auto_tools["mcp_tools"]),
    }


def _resolve_api_tool_names(tenant_id: str, tools: dict[str, str | None]) -> dict[str, str | None]:
    resolved: dict[str, str | None] = {}
    for name, identifier in tools.items():
        predicates = [ApiToolProvider.name == name]
        if _is_uuid_string(identifier):
            predicates.append(ApiToolProvider.id == identifier)
        provider = db.session.scalar(
            sa.select(ApiToolProvider).where(
                ApiToolProvider.tenant_id == tenant_id,
                sa.or_(*predicates),
            )
        )
        resolved[provider.name if provider else name] = provider.id if provider else identifier
    return resolved


def _resolve_workflow_tool_names(tenant_id: str, tools: dict[str, str | None]) -> dict[str, str | None]:
    resolved: dict[str, str | None] = {}
    for name, identifier in tools.items():
        predicates = [WorkflowToolProvider.name == name]
        if _is_uuid_string(identifier):
            predicates.append(WorkflowToolProvider.id == identifier)
        provider = db.session.scalar(
            sa.select(WorkflowToolProvider).where(
                WorkflowToolProvider.tenant_id == tenant_id,
                sa.or_(*predicates),
            )
        )
        resolved[provider.name if provider else name] = provider.id if provider else identifier
    return resolved


def _resolve_mcp_tool_names(tenant_id: str, tools: dict[str, str | None]) -> dict[str, str | None]:
    resolved: dict[str, str | None] = {}
    for name, identifier in tools.items():
        predicates = [MCPToolProvider.name == name]
        if identifier:
            predicates.append(MCPToolProvider.server_identifier == identifier)
        if _is_uuid_string(identifier):
            predicates.append(MCPToolProvider.id == identifier)
        provider = db.session.scalar(
            sa.select(MCPToolProvider).where(
                MCPToolProvider.tenant_id == tenant_id,
                sa.or_(*predicates),
            )
        )
        resolved[provider.name if provider else name] = provider.id if provider else identifier
    return resolved


def _is_uuid_string(value: str | None) -> bool:
    if not value:
        return False
    try:
        UUID(value)
    except ValueError:
        return False
    return True


def _print_auto_tools(auto_tools: WizardToolMap) -> None:
    _print_wizard_step("Automatically Discovered Tools")
    click.echo("Automatically discovered tools:")
    _print_auto_tool_category("Custom API tools", auto_tools["api_tools"])
    _print_auto_tool_category("Workflow tools", auto_tools["workflow_tools"])
    _print_auto_tool_category("MCP tools", auto_tools["mcp_tools"])


def _print_auto_tool_category(label: str, values: dict[str, str | None]) -> None:
    click.echo(label)
    if not values:
        click.echo("- none")
        return
    for name, identifier in sorted(values.items()):
        click.echo(f"- {_format_tool_name_id(name, identifier)}")


def _prompt_additional_tools(tenant_id: str, auto_tools: WizardToolMap) -> WizardToolSelection:
    selections: WizardToolSelection = {"api_tools": [], "workflow_tools": [], "mcp_tools": []}
    _print_wizard_step("Additional Tools")
    if not click.confirm(
        "Export additional tools manually? [y/n, default: n]",
        default=False,
        show_default=False,
    ):
        _print_final_tool_selection(auto_tools, selections, {})
        return selections
    manual_labels: dict[str, str] = {}
    api_tool_options = [
        (tool.name, tool.name, tool.id)
        for tool in db.session.scalars(
            sa.select(ApiToolProvider).where(ApiToolProvider.tenant_id == tenant_id).order_by(ApiToolProvider.name)
        ).all()
    ]
    selections["api_tools"] = _prompt_tool_category(
        "Custom API tools",
        api_tool_options,
        auto_tools=auto_tools["api_tools"],
    )
    manual_labels.update(_selected_tool_labels(api_tool_options, selections["api_tools"]))
    workflow_tool_options = [
        (tool.id, tool.name, tool.id)
        for tool in db.session.scalars(
            sa.select(WorkflowToolProvider)
            .where(WorkflowToolProvider.tenant_id == tenant_id)
            .order_by(WorkflowToolProvider.name)
        ).all()
    ]
    selections["workflow_tools"] = _prompt_tool_category(
        "Workflow tools",
        workflow_tool_options,
        auto_tools=auto_tools["workflow_tools"],
    )
    manual_labels.update(_selected_tool_labels(workflow_tool_options, selections["workflow_tools"]))
    mcp_tool_options = [
        (tool.id, tool.name, tool.server_identifier)
        for tool in db.session.scalars(
            sa.select(MCPToolProvider).where(MCPToolProvider.tenant_id == tenant_id).order_by(MCPToolProvider.name)
        ).all()
    ]
    selections["mcp_tools"] = _prompt_tool_category(
        "MCP tools",
        mcp_tool_options,
        auto_tools=auto_tools["mcp_tools"],
    )
    manual_labels.update(_selected_tool_labels(mcp_tool_options, selections["mcp_tools"]))
    _print_final_tool_selection(auto_tools, selections, manual_labels)
    return selections


def _selected_tool_labels_for_tenant(tenant_id: str, selected_tools: WizardToolSelection) -> dict[str, str]:
    labels: dict[str, str] = {}
    if selected_tools["api_tools"]:
        labels.update(
            _selected_tool_labels(
                [
                    (tool.name, tool.name, tool.id)
                    for tool in db.session.scalars(
                        sa.select(ApiToolProvider)
                        .where(ApiToolProvider.tenant_id == tenant_id)
                        .order_by(ApiToolProvider.name)
                    ).all()
                ],
                selected_tools["api_tools"],
            )
        )
    if selected_tools["workflow_tools"]:
        labels.update(
            _selected_tool_labels(
                [
                    (tool.id, tool.name, tool.id)
                    for tool in db.session.scalars(
                        sa.select(WorkflowToolProvider)
                        .where(WorkflowToolProvider.tenant_id == tenant_id)
                        .order_by(WorkflowToolProvider.name)
                    ).all()
                ],
                selected_tools["workflow_tools"],
            )
        )
    if selected_tools["mcp_tools"]:
        labels.update(
            _selected_tool_labels(
                [
                    (tool.id, tool.name, tool.server_identifier)
                    for tool in db.session.scalars(
                        sa.select(MCPToolProvider)
                        .where(MCPToolProvider.tenant_id == tenant_id)
                        .order_by(MCPToolProvider.name)
                    ).all()
                ],
                selected_tools["mcp_tools"],
            )
        )
    return labels


def _selected_tool_labels(options: list[tuple[str, str, str]], selected_values: list[str]) -> dict[str, str]:
    selected = set(selected_values)
    return {value: _format_tool_name_id(name, detail) for value, name, detail in options if value in selected}


def _prompt_tool_category(
    label: str,
    options: list[tuple[str, str, str]],
    *,
    auto_tools: dict[str, str | None],
) -> list[str]:
    if not options:
        click.echo(f"{label}: none")
        return []
    _print_wizard_step(label)
    for index, (value, name, detail) in enumerate(options, 1):
        marker = "[auto]" if _is_auto_tool(value, name, detail, auto_tools) else "[ ]"
        click.echo(f"{index}. {marker} {name} ({detail})")
    raw = click.prompt(
        f"Select {label.lower()} by number, comma-separated numbers, all, or empty",
        default="",
        show_default=cast(Any, "empty"),
    )
    if not raw.strip():
        return []
    return parse_index_selection(raw, [value for value, _, _ in options])


def _is_auto_tool(value: str, name: str, detail: str, auto_tools: dict[str, str | None]) -> bool:
    return name in auto_tools or value in auto_tools or value in auto_tools.values() or detail in auto_tools.values()


def _print_final_tool_selection(
    auto_tools: WizardToolMap,
    additional_tools: WizardToolSelection,
    manual_labels: dict[str, str],
) -> None:
    _print_wizard_step("Final Tool Selection")
    _print_tool_selection_body(auto_tools, additional_tools, manual_labels)


def _print_tool_selection_body(
    auto_tools: WizardToolMap,
    additional_tools: WizardToolSelection,
    manual_labels: dict[str, str],
) -> None:
    click.echo("Final tools to export:")
    _print_final_tool_category(
        "Custom API tools",
        auto_tools["api_tools"],
        additional_tools["api_tools"],
        manual_labels,
    )
    _print_final_tool_category(
        "Workflow tools",
        auto_tools["workflow_tools"],
        additional_tools["workflow_tools"],
        manual_labels,
    )
    _print_final_tool_category("MCP tools", auto_tools["mcp_tools"], additional_tools["mcp_tools"], manual_labels)


def _print_final_tool_category(
    label: str,
    auto_tools: dict[str, str | None],
    manual_values: list[str],
    manual_labels: dict[str, str],
) -> None:
    click.echo(label)
    lines = [f"- [auto] {_format_tool_name_id(name, identifier)}" for name, identifier in sorted(auto_tools.items())]
    auto_identifiers = {identifier for identifier in auto_tools.values() if identifier}
    lines.extend(
        f"- [manual] {manual_labels.get(value, value)}"
        for value in manual_values
        if value not in auto_tools and value not in auto_identifiers
    )
    if not lines:
        click.echo("- none")
        return
    for line in lines:
        click.echo(line)


def _format_tool_name_id(name: str, identifier: str | None) -> str:
    if identifier and identifier != name:
        return f"{name}: {identifier}"
    return name


def _confirm_wizard_summary(
    *,
    tenant_name: str,
    app_names: list[str],
    auto_tools: WizardToolMap,
    additional_tools: WizardToolSelection,
    manual_labels: dict[str, str],
    include_referenced_tools: bool,
    include_secrets: bool,
    create_tokens: bool,
    id_strategy: str,
    conflict_strategy: str,
    output_file: str,
) -> None:
    _print_wizard_step("Summary")
    click.echo("Migration export summary:")
    click.echo(f"source tenant: {tenant_name}")
    click.echo(f"selected apps: {len(app_names)}")
    for app_name in app_names:
        click.echo(f"- {app_name}")
    click.echo(f"auto referenced tools: {str(include_referenced_tools).lower()}")
    _print_tool_selection_body(auto_tools, additional_tools, manual_labels)
    click.echo(f"include secrets: {str(include_secrets).lower()}")
    click.echo(f"create app api token on import: {str(create_tokens).lower()}")
    click.echo(f"id strategy: {id_strategy}")
    click.echo(f"conflict strategy: {conflict_strategy}")
    click.echo(f"output path: {output_file}")
    if not click.confirm("Write migration package? [y/n, default: y]", default=True, show_default=False):
        raise click.Abort()


def _prompt_output_file() -> tuple[str, bool]:
    default_output = f"migration-data-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    output_file = click.prompt("Output path", default=default_output, show_default=True)
    if output_file.lower() in {"y", "yes", "n", "no"}:
        raise click.ClickException("Output path must be a file path. Press Enter to use the default path.")
    overwrite = False
    if Path(output_file).exists():
        overwrite = click.confirm(
            "Output file exists. Overwrite? [y/n, default: n]",
            default=False,
            show_default=False,
        )
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
        id_mappings=context.id_mappings,
    )


def _render_report(report_items: list[ResourceReportItem], *, context: ReportContext | None = None) -> None:
    for line in MigrationReportService().render(report_items, context=context):
        click.echo(line)
