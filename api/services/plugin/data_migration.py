import json
import logging

import click

from core.entities import DEFAULT_PLUGIN_ID
from models.engine import db

logger = logging.getLogger(__name__)


class PluginDataMigration:
    @classmethod
    def migrate(cls) -> None:
        cls.migrate_db_records("providers", "provider_name")  # large table
        cls.migrate_db_records("provider_models", "provider_name")
        cls.migrate_db_records("provider_orders", "provider_name")
        cls.migrate_db_records("tenant_default_models", "provider_name")
        cls.migrate_db_records("tenant_preferred_model_providers", "provider_name")
        cls.migrate_db_records("provider_model_settings", "provider_name")
        cls.migrate_db_records("load_balancing_model_configs", "provider_name")
        cls.migrate_datasets()
        cls.migrate_db_records("embeddings", "provider_name")  # large table
        cls.migrate_db_records("dataset_collection_bindings", "provider_name")
        cls.migrate_db_records("tool_builtin_providers", "provider")

    @classmethod
    def migrate_datasets(cls) -> None:
        table_name = "datasets"
        provider_column_name = "embedding_model_provider"

        click.echo(click.style(f"Migrating [{table_name}] data for plugin", fg="white"))

        processed_count = 0
        failed_ids = []
        while True:
            sql = f"""select id, {provider_column_name} as provider_name, retrieval_model from {table_name}
where {provider_column_name} not like '%/%' and {provider_column_name} is not null and {provider_column_name} != ''
limit 1000"""
            with db.engine.begin() as conn:
                rs = conn.execute(db.text(sql))

                current_iter_count = 0
                for i in rs:
                    record_id = str(i.id)
                    provider_name = str(i.provider_name)
                    retrieval_model = i.retrieval_model
                    print(type(retrieval_model))

                    if record_id in failed_ids:
                        continue

                    retrieval_model_changed = False
                    if retrieval_model:
                        if (
                            "reranking_model" in retrieval_model
                            and "reranking_provider_name" in retrieval_model["reranking_model"]
                            and retrieval_model["reranking_model"]["reranking_provider_name"]
                            and "/" not in retrieval_model["reranking_model"]["reranking_provider_name"]
                        ):
                            click.echo(
                                click.style(
                                    f"[{processed_count}] Migrating {table_name} {record_id} "
                                    f"(reranking_provider_name: "
                                    f"{retrieval_model['reranking_model']['reranking_provider_name']})",
                                    fg="white",
                                )
                            )
                            retrieval_model["reranking_model"]["reranking_provider_name"] = (
                                f"{DEFAULT_PLUGIN_ID}/{retrieval_model['reranking_model']['reranking_provider_name']}/{retrieval_model['reranking_model']['reranking_provider_name']}"
                            )
                            retrieval_model_changed = True

                    click.echo(
                        click.style(
                            f"[{processed_count}] Migrating [{table_name}] {record_id} ({provider_name})",
                            fg="white",
                        )
                    )

                    try:
                        # update provider name append with "langgenius/{provider_name}/{provider_name}"
                        params = {"record_id": record_id}
                        update_retrieval_model_sql = ""
                        if retrieval_model and retrieval_model_changed:
                            update_retrieval_model_sql = ", retrieval_model = :retrieval_model"
                            params["retrieval_model"] = json.dumps(retrieval_model)

                        sql = f"""update {table_name} 
                        set {provider_column_name} = 
                        concat('{DEFAULT_PLUGIN_ID}/', {provider_column_name}, '/', {provider_column_name}) 
                        {update_retrieval_model_sql}
                        where id = :record_id"""
                        conn.execute(db.text(sql), params)
                        click.echo(
                            click.style(
                                f"[{processed_count}] Migrated [{table_name}] {record_id} ({provider_name})",
                                fg="green",
                            )
                        )
                    except Exception:
                        failed_ids.append(record_id)
                        click.echo(
                            click.style(
                                f"[{processed_count}] Failed to migrate [{table_name}] {record_id} ({provider_name})",
                                fg="red",
                            )
                        )
                        logger.exception(
                            f"[{processed_count}] Failed to migrate [{table_name}] {record_id} ({provider_name})"
                        )
                        continue

                    current_iter_count += 1
                    processed_count += 1

            if not current_iter_count:
                break

        click.echo(
            click.style(f"Migrate [{table_name}] data for plugin completed, total: {processed_count}", fg="green")
        )

    @classmethod
    def migrate_db_records(cls, table_name: str, provider_column_name: str) -> None:
        click.echo(click.style(f"Migrating [{table_name}] data for plugin", fg="white"))

        processed_count = 0
        failed_ids = []
        while True:
            sql = f"""select id, {provider_column_name} as provider_name from {table_name}
where {provider_column_name} not like '%/%' and {provider_column_name} is not null and {provider_column_name} != ''
limit 1000"""
            with db.engine.begin() as conn:
                rs = conn.execute(db.text(sql))

                current_iter_count = 0
                for i in rs:
                    current_iter_count += 1
                    processed_count += 1
                    record_id = str(i.id)
                    provider_name = str(i.provider_name)

                    if record_id in failed_ids:
                        continue

                    click.echo(
                        click.style(
                            f"[{processed_count}] Migrating [{table_name}] {record_id} ({provider_name})",
                            fg="white",
                        )
                    )

                    try:
                        # update provider name append with "langgenius/{provider_name}/{provider_name}"
                        sql = f"""update {table_name} 
                        set {provider_column_name} = 
                        concat('{DEFAULT_PLUGIN_ID}/', {provider_column_name}, '/', {provider_column_name}) 
                        where id = :record_id"""
                        conn.execute(db.text(sql), {"record_id": record_id})
                        click.echo(
                            click.style(
                                f"[{processed_count}] Migrated [{table_name}] {record_id} ({provider_name})",
                                fg="green",
                            )
                        )
                    except Exception:
                        failed_ids.append(record_id)
                        click.echo(
                            click.style(
                                f"[{processed_count}] Failed to migrate [{table_name}] {record_id} ({provider_name})",
                                fg="red",
                            )
                        )
                        logger.exception(
                            f"[{processed_count}] Failed to migrate [{table_name}] {record_id} ({provider_name})"
                        )
                        continue

            if not current_iter_count:
                break

        click.echo(
            click.style(f"Migrate [{table_name}] data for plugin completed, total: {processed_count}", fg="green")
        )
