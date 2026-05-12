import json
from typing import cast

import click
import sqlalchemy as sa
from sqlalchemy import update
from sqlalchemy.engine import CursorResult

from configs import dify_config
from extensions.ext_database import db
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from extensions.storage.storage_type import StorageType
from models.model import UploadFile


@click.option("-f", "--force", is_flag=True, help="Skip user confirmation and force the command to execute.")
@click.command("clear-orphaned-file-records", help="Clear orphaned file records.")
def clear_orphaned_file_records(force: bool):
    """
    Clear orphaned file records in the database.
    """

    # define tables and columns to process
    files_tables = [
        {"table": "upload_files", "id_column": "id", "key_column": "key"},
        {"table": "tool_files", "id_column": "id", "key_column": "file_key"},
    ]
    ids_tables = [
        {"type": "uuid", "table": "message_files", "column": "upload_file_id"},
        {"type": "text", "table": "documents", "column": "data_source_info"},
        {"type": "text", "table": "document_segments", "column": "content"},
        {"type": "text", "table": "messages", "column": "answer"},
        {"type": "text", "table": "workflow_node_executions", "column": "inputs"},
        {"type": "text", "table": "workflow_node_executions", "column": "process_data"},
        {"type": "text", "table": "workflow_node_executions", "column": "outputs"},
        {"type": "text", "table": "conversations", "column": "introduction"},
        {"type": "text", "table": "conversations", "column": "system_instruction"},
        {"type": "text", "table": "accounts", "column": "avatar"},
        {"type": "text", "table": "apps", "column": "icon"},
        {"type": "text", "table": "sites", "column": "icon"},
        {"type": "json", "table": "messages", "column": "inputs"},
        {"type": "json", "table": "messages", "column": "message"},
    ]

    # notify user and ask for confirmation
    click.echo(
        click.style(
            "This command will first find and delete orphaned file records from the message_files table,", fg="yellow"
        )
    )
    click.echo(
        click.style(
            "and then it will find and delete orphaned file records in the following tables:",
            fg="yellow",
        )
    )
    for files_table in files_tables:
        click.echo(click.style(f"- {files_table['table']}", fg="yellow"))
    click.echo(
        click.style("The following tables and columns will be scanned to find orphaned file records:", fg="yellow")
    )
    for ids_table in ids_tables:
        click.echo(click.style(f"- {ids_table['table']} ({ids_table['column']})", fg="yellow"))
    click.echo("")

    click.echo(click.style("!!! USE WITH CAUTION !!!", fg="red"))
    click.echo(
        click.style(
            (
                "Since not all patterns have been fully tested, "
                "please note that this command may delete unintended file records."
            ),
            fg="yellow",
        )
    )
    click.echo(
        click.style("This cannot be undone. Please make sure to back up your database before proceeding.", fg="yellow")
    )
    click.echo(
        click.style(
            (
                "It is also recommended to run this during the maintenance window, "
                "as this may cause high load on your instance."
            ),
            fg="yellow",
        )
    )
    if not force:
        click.confirm("Do you want to proceed?", abort=True)

    # start the cleanup process
    click.echo(click.style("Starting orphaned file records cleanup.", fg="white"))

    # clean up the orphaned records in the message_files table where message_id doesn't exist in messages table
    try:
        click.echo(
            click.style("- Listing message_files records where message_id doesn't exist in messages table", fg="white")
        )
        query = (
            "SELECT mf.id, mf.message_id "
            "FROM message_files mf LEFT JOIN messages m ON mf.message_id = m.id "
            "WHERE m.id IS NULL"
        )
        orphaned_message_files = []
        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(query))
            for i in rs:
                orphaned_message_files.append({"id": str(i[0]), "message_id": str(i[1])})

        if orphaned_message_files:
            click.echo(click.style(f"Found {len(orphaned_message_files)} orphaned message_files records:", fg="white"))
            for record in orphaned_message_files:
                click.echo(click.style(f"  - id: {record['id']}, message_id: {record['message_id']}", fg="black"))

            if not force:
                click.confirm(
                    (
                        f"Do you want to proceed "
                        f"to delete all {len(orphaned_message_files)} orphaned message_files records?"
                    ),
                    abort=True,
                )

            click.echo(click.style("- Deleting orphaned message_files records", fg="white"))
            query = "DELETE FROM message_files WHERE id IN :ids"
            with db.engine.begin() as conn:
                conn.execute(sa.text(query), {"ids": tuple(record["id"] for record in orphaned_message_files)})
            click.echo(
                click.style(f"Removed {len(orphaned_message_files)} orphaned message_files records.", fg="green")
            )
        else:
            click.echo(click.style("No orphaned message_files records found. There is nothing to delete.", fg="green"))
    except Exception as e:
        click.echo(click.style(f"Error deleting orphaned message_files records: {str(e)}", fg="red"))

    # clean up the orphaned records in the rest of the *_files tables
    try:
        # fetch file id and keys from each table
        all_files_in_tables = []
        for files_table in files_tables:
            click.echo(click.style(f"- Listing file records in table {files_table['table']}", fg="white"))
            query = f"SELECT {files_table['id_column']}, {files_table['key_column']} FROM {files_table['table']}"
            with db.engine.begin() as conn:
                rs = conn.execute(sa.text(query))
            for i in rs:
                all_files_in_tables.append({"table": files_table["table"], "id": str(i[0]), "key": i[1]})
        click.echo(click.style(f"Found {len(all_files_in_tables)} files in tables.", fg="white"))

        # fetch referred table and columns
        guid_regexp = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
        all_ids_in_tables = []
        for ids_table in ids_tables:
            query = ""
            match ids_table["type"]:
                case "uuid":
                    click.echo(
                        click.style(
                            f"- Listing file ids in column {ids_table['column']} in table {ids_table['table']}",
                            fg="white",
                        )
                    )
                    c = ids_table["column"]
                    query = f"SELECT {c} FROM {ids_table['table']} WHERE {c} IS NOT NULL"
                    with db.engine.begin() as conn:
                        rs = conn.execute(sa.text(query))
                    for i in rs:
                        all_ids_in_tables.append({"table": ids_table["table"], "id": str(i[0])})
                case "text":
                    t = ids_table["table"]
                    click.echo(
                        click.style(
                            f"- Listing file-id-like strings in column {ids_table['column']} in table {t}",
                            fg="white",
                        )
                    )
                    query = (
                        f"SELECT regexp_matches({ids_table['column']}, '{guid_regexp}', 'g') AS extracted_id "
                        f"FROM {ids_table['table']}"
                    )
                    with db.engine.begin() as conn:
                        rs = conn.execute(sa.text(query))
                    for i in rs:
                        for j in i[0]:
                            all_ids_in_tables.append({"table": ids_table["table"], "id": j})
                case "json":
                    click.echo(
                        click.style(
                            (
                                f"- Listing file-id-like JSON string in column {ids_table['column']} "
                                f"in table {ids_table['table']}"
                            ),
                            fg="white",
                        )
                    )
                    query = (
                        f"SELECT regexp_matches({ids_table['column']}::text, '{guid_regexp}', 'g') AS extracted_id "
                        f"FROM {ids_table['table']}"
                    )
                    with db.engine.begin() as conn:
                        rs = conn.execute(sa.text(query))
                    for i in rs:
                        for j in i[0]:
                            all_ids_in_tables.append({"table": ids_table["table"], "id": j})
                case _:
                    pass
        click.echo(click.style(f"Found {len(all_ids_in_tables)} file ids in tables.", fg="white"))

    except Exception as e:
        click.echo(click.style(f"Error fetching keys: {str(e)}", fg="red"))
        return

    # find orphaned files
    all_files = [file["id"] for file in all_files_in_tables]
    all_ids = [file["id"] for file in all_ids_in_tables]
    orphaned_files = list(set(all_files) - set(all_ids))
    if not orphaned_files:
        click.echo(click.style("No orphaned file records found. There is nothing to delete.", fg="green"))
        return
    click.echo(click.style(f"Found {len(orphaned_files)} orphaned file records.", fg="white"))
    for file in orphaned_files:
        click.echo(click.style(f"- orphaned file id: {file}", fg="black"))
    if not force:
        click.confirm(f"Do you want to proceed to delete all {len(orphaned_files)} orphaned file records?", abort=True)

    # delete orphaned records for each file
    try:
        for files_table in files_tables:
            click.echo(click.style(f"- Deleting orphaned file records in table {files_table['table']}", fg="white"))
            query = f"DELETE FROM {files_table['table']} WHERE {files_table['id_column']} IN :ids"
            with db.engine.begin() as conn:
                conn.execute(sa.text(query), {"ids": tuple(orphaned_files)})
    except Exception as e:
        click.echo(click.style(f"Error deleting orphaned file records: {str(e)}", fg="red"))
        return
    click.echo(click.style(f"Removed {len(orphaned_files)} orphaned file records.", fg="green"))


@click.option("-f", "--force", is_flag=True, help="Skip user confirmation and force the command to execute.")
@click.command("remove-orphaned-files-on-storage", help="Remove orphaned files on the storage.")
def remove_orphaned_files_on_storage(force: bool):
    """
    Remove orphaned files on the storage.
    """

    # define tables and columns to process
    files_tables = [
        {"table": "upload_files", "key_column": "key"},
        {"table": "tool_files", "key_column": "file_key"},
    ]
    storage_paths = ["image_files", "tools", "upload_files"]

    # notify user and ask for confirmation
    click.echo(click.style("This command will find and remove orphaned files on the storage,", fg="yellow"))
    click.echo(
        click.style("by comparing the files on the storage with the records in the following tables:", fg="yellow")
    )
    for files_table in files_tables:
        click.echo(click.style(f"- {files_table['table']}", fg="yellow"))
    click.echo(click.style("The following paths on the storage will be scanned to find orphaned files:", fg="yellow"))
    for storage_path in storage_paths:
        click.echo(click.style(f"- {storage_path}", fg="yellow"))
    click.echo("")

    click.echo(click.style("!!! USE WITH CAUTION !!!", fg="red"))
    click.echo(
        click.style(
            "Currently, this command will work only for opendal based storage (STORAGE_TYPE=opendal).", fg="yellow"
        )
    )
    click.echo(
        click.style(
            "Since not all patterns have been fully tested, please note that this command may delete unintended files.",
            fg="yellow",
        )
    )
    click.echo(
        click.style("This cannot be undone. Please make sure to back up your storage before proceeding.", fg="yellow")
    )
    click.echo(
        click.style(
            (
                "It is also recommended to run this during the maintenance window, "
                "as this may cause high load on your instance."
            ),
            fg="yellow",
        )
    )
    if not force:
        click.confirm("Do you want to proceed?", abort=True)

    # start the cleanup process
    click.echo(click.style("Starting orphaned files cleanup.", fg="white"))

    # fetch file id and keys from each table
    all_files_in_tables = []
    try:
        for files_table in files_tables:
            click.echo(click.style(f"- Listing files from table {files_table['table']}", fg="white"))
            query = f"SELECT {files_table['key_column']} FROM {files_table['table']}"
            with db.engine.begin() as conn:
                rs = conn.execute(sa.text(query))
            for i in rs:
                all_files_in_tables.append(str(i[0]))
        click.echo(click.style(f"Found {len(all_files_in_tables)} files in tables.", fg="white"))
    except Exception as e:
        click.echo(click.style(f"Error fetching keys: {str(e)}", fg="red"))
        return

    all_files_on_storage = []
    for storage_path in storage_paths:
        try:
            click.echo(click.style(f"- Scanning files on storage path {storage_path}", fg="white"))
            files = storage.scan(path=storage_path, files=True, directories=False)
            all_files_on_storage.extend(files)
        except FileNotFoundError:
            click.echo(click.style(f"  -> Skipping path {storage_path} as it does not exist.", fg="yellow"))
            continue
        except Exception as e:
            click.echo(click.style(f"  -> Error scanning files on storage path {storage_path}: {str(e)}", fg="red"))
            continue
    click.echo(click.style(f"Found {len(all_files_on_storage)} files on storage.", fg="white"))

    # find orphaned files
    orphaned_files = list(set(all_files_on_storage) - set(all_files_in_tables))
    if not orphaned_files:
        click.echo(click.style("No orphaned files found. There is nothing to remove.", fg="green"))
        return
    click.echo(click.style(f"Found {len(orphaned_files)} orphaned files.", fg="white"))
    for file in orphaned_files:
        click.echo(click.style(f"- orphaned file: {file}", fg="black"))
    if not force:
        click.confirm(f"Do you want to proceed to remove all {len(orphaned_files)} orphaned files?", abort=True)

    # delete orphaned files
    removed_files = 0
    error_files = 0
    for file in orphaned_files:
        try:
            storage.delete(file)
            removed_files += 1
            click.echo(click.style(f"- Removing orphaned file: {file}", fg="white"))
        except Exception as e:
            error_files += 1
            click.echo(click.style(f"- Error deleting orphaned file {file}: {str(e)}", fg="red"))
            continue
    if error_files == 0:
        click.echo(click.style(f"Removed {removed_files} orphaned files without errors.", fg="green"))
    else:
        click.echo(click.style(f"Removed {removed_files} orphaned files, with {error_files} errors.", fg="yellow"))


@click.command("file-usage", help="Query file usages and show where files are referenced.")
@click.option("--file-id", type=str, default=None, help="Filter by file UUID.")
@click.option("--key", type=str, default=None, help="Filter by storage key.")
@click.option("--src", type=str, default=None, help="Filter by table.column pattern (e.g., 'documents.%' or '%.icon').")
@click.option("--limit", type=int, default=100, help="Limit number of results (default: 100).")
@click.option("--offset", type=int, default=0, help="Offset for pagination (default: 0).")
@click.option("--json", "output_json", is_flag=True, help="Output results in JSON format.")
def file_usage(
    file_id: str | None,
    key: str | None,
    src: str | None,
    limit: int,
    offset: int,
    output_json: bool,
):
    """
    Query file usages and show where files are referenced in the database.

    This command reuses the same reference checking logic as clear-orphaned-file-records
    and displays detailed information about where each file is referenced.
    """
    # define tables and columns to process
    files_tables = [
        {"table": "upload_files", "id_column": "id", "key_column": "key"},
        {"table": "tool_files", "id_column": "id", "key_column": "file_key"},
    ]
    ids_tables = [
        {"type": "uuid", "table": "message_files", "column": "upload_file_id", "pk_column": "id"},
        {"type": "text", "table": "documents", "column": "data_source_info", "pk_column": "id"},
        {"type": "text", "table": "document_segments", "column": "content", "pk_column": "id"},
        {"type": "text", "table": "messages", "column": "answer", "pk_column": "id"},
        {"type": "text", "table": "workflow_node_executions", "column": "inputs", "pk_column": "id"},
        {"type": "text", "table": "workflow_node_executions", "column": "process_data", "pk_column": "id"},
        {"type": "text", "table": "workflow_node_executions", "column": "outputs", "pk_column": "id"},
        {"type": "text", "table": "conversations", "column": "introduction", "pk_column": "id"},
        {"type": "text", "table": "conversations", "column": "system_instruction", "pk_column": "id"},
        {"type": "text", "table": "accounts", "column": "avatar", "pk_column": "id"},
        {"type": "text", "table": "apps", "column": "icon", "pk_column": "id"},
        {"type": "text", "table": "sites", "column": "icon", "pk_column": "id"},
        {"type": "json", "table": "messages", "column": "inputs", "pk_column": "id"},
        {"type": "json", "table": "messages", "column": "message", "pk_column": "id"},
    ]

    # Stream file usages with pagination to avoid holding all results in memory
    paginated_usages = []
    total_count = 0

    # First, build a mapping of file_id -> storage_key from the base tables
    file_key_map = {}
    for files_table in files_tables:
        query = f"SELECT {files_table['id_column']}, {files_table['key_column']} FROM {files_table['table']}"
        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(query))
            for row in rs:
                file_key_map[str(row[0])] = f"{files_table['table']}:{row[1]}"

    # If filtering by key or file_id, verify it exists
    if file_id and file_id not in file_key_map:
        if output_json:
            click.echo(json.dumps({"error": f"File ID {file_id} not found in base tables"}))
        else:
            click.echo(click.style(f"File ID {file_id} not found in base tables.", fg="red"))
        return

    if key:
        valid_prefixes = {f"upload_files:{key}", f"tool_files:{key}"}
        matching_file_ids = [fid for fid, fkey in file_key_map.items() if fkey in valid_prefixes]
        if not matching_file_ids:
            if output_json:
                click.echo(json.dumps({"error": f"Key {key} not found in base tables"}))
            else:
                click.echo(click.style(f"Key {key} not found in base tables.", fg="red"))
            return

    guid_regexp = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

    # For each reference table/column, find matching file IDs and record the references
    for ids_table in ids_tables:
        src_filter = f"{ids_table['table']}.{ids_table['column']}"

        # Skip if src filter doesn't match (use fnmatch for wildcard patterns)
        if src:
            if "%" in src or "_" in src:
                import fnmatch

                # Convert SQL LIKE wildcards to fnmatch wildcards (% -> *, _ -> ?)
                pattern = src.replace("%", "*").replace("_", "?")
                if not fnmatch.fnmatch(src_filter, pattern):
                    continue
            else:
                if src_filter != src:
                    continue

        match ids_table["type"]:
            case "uuid":
                # Direct UUID match
                query = (
                    f"SELECT {ids_table['pk_column']}, {ids_table['column']} "
                    f"FROM {ids_table['table']} WHERE {ids_table['column']} IS NOT NULL"
                )
                with db.engine.begin() as conn:
                    rs = conn.execute(sa.text(query))
                    for row in rs:
                        record_id = str(row[0])
                        ref_file_id = str(row[1])
                        if ref_file_id not in file_key_map:
                            continue
                        storage_key = file_key_map[ref_file_id]

                        # Apply filters
                        if file_id and ref_file_id != file_id:
                            continue
                        if key and not storage_key.endswith(key):
                            continue

                        # Only collect items within the requested page range
                        if offset <= total_count < offset + limit:
                            paginated_usages.append(
                                {
                                    "src": f"{ids_table['table']}.{ids_table['column']}",
                                    "record_id": record_id,
                                    "file_id": ref_file_id,
                                    "key": storage_key,
                                }
                            )
                        total_count += 1

            case "text" | "json":
                # Extract UUIDs from text/json content
                column_cast = f"{ids_table['column']}::text" if ids_table["type"] == "json" else ids_table["column"]
                query = (
                    f"SELECT {ids_table['pk_column']}, {column_cast} "
                    f"FROM {ids_table['table']} WHERE {ids_table['column']} IS NOT NULL"
                )
                with db.engine.begin() as conn:
                    rs = conn.execute(sa.text(query))
                    for row in rs:
                        record_id = str(row[0])
                        content = str(row[1])

                        # Find all UUIDs in the content
                        import re

                        uuid_pattern = re.compile(guid_regexp, re.IGNORECASE)
                        matches = uuid_pattern.findall(content)

                        for ref_file_id in matches:
                            if ref_file_id not in file_key_map:
                                continue
                            storage_key = file_key_map[ref_file_id]

                            # Apply filters
                            if file_id and ref_file_id != file_id:
                                continue
                            if key and not storage_key.endswith(key):
                                continue

                            # Only collect items within the requested page range
                            if offset <= total_count < offset + limit:
                                paginated_usages.append(
                                    {
                                        "src": f"{ids_table['table']}.{ids_table['column']}",
                                        "record_id": record_id,
                                        "file_id": ref_file_id,
                                        "key": storage_key,
                                    }
                                )
                            total_count += 1
            case _:
                pass

    # Output results
    if output_json:
        result = {
            "total": total_count,
            "offset": offset,
            "limit": limit,
            "usages": paginated_usages,
        }
        click.echo(json.dumps(result, indent=2))
    else:
        click.echo(
            click.style(f"Found {total_count} file usages (showing {len(paginated_usages)} results)", fg="white")
        )
        click.echo("")

        if not paginated_usages:
            click.echo(click.style("No file usages found matching the specified criteria.", fg="yellow"))
            return

        # Print table header
        click.echo(
            click.style(
                f"{'Src (Table.Column)':<50} {'Record ID':<40} {'File ID':<40} {'Storage Key':<60}",
                fg="cyan",
            )
        )
        click.echo(click.style("-" * 190, fg="white"))

        # Print each usage
        for usage in paginated_usages:
            click.echo(f"{usage['src']:<50} {usage['record_id']:<40} {usage['file_id']:<40} {usage['key']:<60}")

        # Show pagination info
        if offset + limit < total_count:
            click.echo("")
            click.echo(
                click.style(
                    f"Showing {offset + 1}-{offset + len(paginated_usages)} of {total_count} results", fg="white"
                )
            )
            click.echo(click.style(f"Use --offset {offset + limit} to see next page", fg="white"))


@click.command(
    "migrate-oss",
    help="Migrate files from Local or OpenDAL source to a cloud OSS storage (destination must NOT be local/opendal).",
)
@click.option(
    "--path",
    "paths",
    multiple=True,
    help="Storage path prefixes to migrate (repeatable). Defaults: privkeys, upload_files, image_files,"
    " tools, website_files, keyword_files, ops_trace",
)
@click.option(
    "--source",
    type=click.Choice(["local", "opendal"], case_sensitive=False),
    default="opendal",
    show_default=True,
    help="Source storage type to read from",
)
@click.option("--overwrite", is_flag=True, default=False, help="Overwrite destination if file already exists")
@click.option("--dry-run", is_flag=True, default=False, help="Show what would be migrated without uploading")
@click.option("-f", "--force", is_flag=True, help="Skip confirmation and run without prompts")
@click.option(
    "--update-db/--no-update-db",
    default=True,
    help="Update upload_files.storage_type from source type to current storage after migration",
)
def migrate_oss(
    paths: tuple[str, ...],
    source: str,
    overwrite: bool,
    dry_run: bool,
    force: bool,
    update_db: bool,
):
    """
    Copy all files under selected prefixes from a source storage
    (Local filesystem or OpenDAL-backed) into the currently configured
    destination storage backend, then optionally update DB records.

    Expected usage: set STORAGE_TYPE (and its credentials) to your target backend.
    """
    # Ensure target storage is not local/opendal
    if dify_config.STORAGE_TYPE in (StorageType.LOCAL, StorageType.OPENDAL):
        click.echo(
            click.style(
                "Target STORAGE_TYPE must be a cloud OSS (not 'local' or 'opendal').\n"
                "Please set STORAGE_TYPE to one of: s3, aliyun-oss, azure-blob, google-storage, tencent-cos, \n"
                "volcengine-tos, supabase, oci-storage, huawei-obs, baidu-obs, clickzetta-volume.",
                fg="red",
            )
        )
        return

    # Default paths if none specified
    default_paths = ("privkeys", "upload_files", "image_files", "tools", "website_files", "keyword_files", "ops_trace")
    path_list = list(paths) if paths else list(default_paths)
    is_source_local = source.lower() == "local"

    click.echo(click.style("Preparing migration to target storage.", fg="yellow"))
    click.echo(click.style(f"Target storage type: {dify_config.STORAGE_TYPE}", fg="white"))
    if is_source_local:
        src_root = dify_config.STORAGE_LOCAL_PATH
        click.echo(click.style(f"Source: local fs, root: {src_root}", fg="white"))
    else:
        click.echo(click.style(f"Source: opendal scheme={dify_config.OPENDAL_SCHEME}", fg="white"))
    click.echo(click.style(f"Paths to migrate: {', '.join(path_list)}", fg="white"))
    click.echo("")

    if not force:
        click.confirm("Proceed with migration?", abort=True)

    # Instantiate source storage
    try:
        if is_source_local:
            src_root = dify_config.STORAGE_LOCAL_PATH
            source_storage = OpenDALStorage(scheme="fs", root=src_root)
        else:
            source_storage = OpenDALStorage(scheme=dify_config.OPENDAL_SCHEME)
    except Exception as e:
        click.echo(click.style(f"Failed to initialize source storage: {str(e)}", fg="red"))
        return

    total_files = 0
    copied_files = 0
    skipped_files = 0
    errored_files = 0
    copied_upload_file_keys: list[str] = []

    for prefix in path_list:
        click.echo(click.style(f"Scanning source path: {prefix}", fg="white"))
        try:
            keys = source_storage.scan(path=prefix, files=True, directories=False)
        except FileNotFoundError:
            click.echo(click.style(f"  -> Skipping missing path: {prefix}", fg="yellow"))
            continue
        except NotImplementedError:
            click.echo(click.style("  -> Source storage does not support scanning.", fg="red"))
            return
        except Exception as e:
            click.echo(click.style(f"  -> Error scanning '{prefix}': {str(e)}", fg="red"))
            continue

        click.echo(click.style(f"Found {len(keys)} files under {prefix}", fg="white"))

        for key in keys:
            total_files += 1

            # check destination existence
            if not overwrite:
                try:
                    if storage.exists(key):
                        skipped_files += 1
                        continue
                except Exception as e:
                    # existence check failures should not block migration attempt
                    # but should be surfaced to user as a warning for visibility
                    click.echo(
                        click.style(
                            f"  -> Warning: failed target existence check for {key}: {str(e)}",
                            fg="yellow",
                        )
                    )

            if dry_run:
                copied_files += 1
                continue

            # read from source and write to destination
            try:
                data = source_storage.load_once(key)
            except FileNotFoundError:
                errored_files += 1
                click.echo(click.style(f"  -> Missing on source: {key}", fg="yellow"))
                continue
            except Exception as e:
                errored_files += 1
                click.echo(click.style(f"  -> Error reading {key}: {str(e)}", fg="red"))
                continue

            try:
                storage.save(key, data)
                copied_files += 1
                if prefix == "upload_files":
                    copied_upload_file_keys.append(key)
            except Exception as e:
                errored_files += 1
                click.echo(click.style(f"  -> Error writing {key} to target: {str(e)}", fg="red"))
                continue

    click.echo("")
    click.echo(click.style("Migration summary:", fg="yellow"))
    click.echo(click.style(f"  Total:   {total_files}", fg="white"))
    click.echo(click.style(f"  Copied:  {copied_files}", fg="green"))
    click.echo(click.style(f"  Skipped: {skipped_files}", fg="white"))
    if errored_files:
        click.echo(click.style(f"  Errors:  {errored_files}", fg="red"))

    if dry_run:
        click.echo(click.style("Dry-run complete. No changes were made.", fg="green"))
        return

    if errored_files:
        click.echo(
            click.style(
                "Some files failed to migrate. Review errors above before updating DB records.",
                fg="yellow",
            )
        )
        if update_db and not force:
            if not click.confirm("Proceed to update DB storage_type despite errors?", default=False):
                update_db = False

    # Optionally update DB records for upload_files.storage_type (only for successfully copied upload_files)
    if update_db:
        if not copied_upload_file_keys:
            click.echo(click.style("No upload_files copied. Skipping DB storage_type update.", fg="yellow"))
        else:
            try:
                source_storage_type = StorageType.LOCAL if is_source_local else StorageType.OPENDAL
                updated = cast(
                    CursorResult,
                    db.session.execute(
                        update(UploadFile)
                        .where(
                            UploadFile.storage_type == source_storage_type,
                            UploadFile.key.in_(copied_upload_file_keys),
                        )
                        .values(storage_type=dify_config.STORAGE_TYPE)
                    ),
                ).rowcount
                db.session.commit()
                click.echo(click.style(f"Updated storage_type for {updated} upload_files records.", fg="green"))
            except Exception as e:
                db.session.rollback()
                click.echo(click.style(f"Failed to update DB storage_type: {str(e)}", fg="red"))
