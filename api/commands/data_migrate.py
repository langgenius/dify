import io
import os
import sys
from contextlib import AbstractContextManager, nullcontext
from pathlib import Path
from typing import cast

import click

from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelType
from services.legacy_model_type_migration import (
    VALID_TABLE_NAMES,
    LegacyModelTypeMigrationService,
    load_tenant_ids_from_file,
)

_SUPPORTED_MODEL_TYPE_CHOICES = (
    ModelType.LLM.value,
    ModelType.TEXT_EMBEDDING.value,
    ModelType.RERANK.value,
)
_DEFAULT_CONCURRENCY = os.cpu_count() or 1


def _normalize_multi_value_option(
    values: tuple[str, ...],
    *,
    valid_values: tuple[str, ...],
    option_name: str,
) -> tuple[str, ...]:
    normalized_values: list[str] = []
    seen_values: set[str] = set()

    for value in values:
        for item in value.split(","):
            normalized_item = item.strip()
            if not normalized_item:
                continue
            if normalized_item not in valid_values:
                raise click.BadParameter(
                    f"invalid value '{normalized_item}'. valid values: {', '.join(valid_values)}",
                    param_hint=option_name,
                )
            if normalized_item in seen_values:
                continue
            seen_values.add(normalized_item)
            normalized_values.append(normalized_item)

    return tuple(normalized_values)


@click.group(
    "data-migrate",
    help="Online data migration commands.",
)
def data_migrate() -> None:
    """Namespace for production data migration commands."""


@click.command(
    "legacy-model-types",
    help=(
        "Migrate legacy provider model_type values to canonical values. "
        "Default is dry-run and emits JSON lines only. "
        "If --tables includes provider_model_credentials, the command may also update "
        "provider_models and load_balancing_model_configs references so merged credentials stay reachable."
    ),
)
@click.option(
    "--apply",
    is_flag=True,
    default=False,
    help="Apply the migration. Default is dry-run.",
)
@click.option(
    "--tables",
    "tables",
    multiple=True,
    type=str,
    help=(
        "Limit migration to specific tables. Accepts comma-separated values or repeated flags.\n"
        "\n"
        "Options: load_balancing_model_configs, provider_model_credentials, "
        "provider_model_settings, provider_models, tenant_default_models.\n\n"
        "When provider_model_credentials is selected, provider_models and "
        "load_balancing_model_configs may also be updated for credential reference rewrites.\n"
        "\n"
        "If unspecified, all relevant tables are migrated."
    ),
)
@click.option(
    "--model-types",
    "model_types",
    multiple=True,
    type=str,
    help=(
        "Canonical model types to migrate. Accepts comma-separated values or repeated flags.\n"
        "\n"
        "Options: llm,text-embedding,rerank\n"
        "\n"
        "If unspecified, all relevant legacy model types are migrated."
    ),
)
@click.option(
    "--tenant-id-file",
    type=click.Path(exists=True, dir_okay=False, readable=True, resolve_path=True),
    help="Optional file containing tenant ids, one per line.",
)
@click.option(
    "--output",
    type=click.Path(dir_okay=False, resolve_path=True, path_type=Path),
    help=(
        "Optional file path for JSON lines event logs. Defaults to stdout.\n"
        "It's highly recommended to save the event logs to a file and preserve it for a period of time."
    ),
)
@click.option(
    "--concurrency",
    type=click.IntRange(min=1),
    default=_DEFAULT_CONCURRENCY,
    show_default=True,
    help="Number of tenant-level worker threads to run in parallel.",
)
def legacy_model_types(
    apply: bool,
    tables: tuple[str, ...],
    model_types: tuple[str, ...],
    tenant_id_file: str | None,
    output: Path | None,
    concurrency: int = _DEFAULT_CONCURRENCY,
) -> None:
    """
    Migrate legacy provider-related model_type values and emit JSON lines events.
    """

    normalized_tables = _normalize_multi_value_option(
        tables,
        valid_values=VALID_TABLE_NAMES,
        option_name="--tables",
    )
    normalized_model_types = _normalize_multi_value_option(
        model_types,
        valid_values=_SUPPORTED_MODEL_TYPE_CHOICES,
        option_name="--model-types",
    )
    selected_model_types = (
        tuple(ModelType.value_of(model_type) for model_type in normalized_model_types)
        if normalized_model_types
        else (
            ModelType.LLM,
            ModelType.TEXT_EMBEDDING,
            ModelType.RERANK,
        )
    )
    tenant_ids = load_tenant_ids_from_file(tenant_id_file) if tenant_id_file else None

    output_context: AbstractContextManager[io.TextIOBase]
    if output is None:
        output_context = nullcontext(cast(io.TextIOBase, sys.stdout))
    else:
        try:
            output_context = output.open("w", encoding="utf-8")
        except OSError as exc:
            raise click.ClickException(f"failed to open output file '{output}': {exc.strerror or exc}") from exc

    with output_context as output_stream:
        LegacyModelTypeMigrationService(
            engine=db.engine,
            apply=apply,
            concurrency=concurrency,
            output=cast(io.TextIOBase, output_stream),
            tables=normalized_tables or None,
            model_types=selected_model_types,
            tenant_ids=tenant_ids,
        ).migrate()


data_migrate.add_command(legacy_model_types)
