import base64
import json
import logging
import secrets
from typing import Any

import click
import sqlalchemy as sa
from flask import current_app
from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from constants.languages import languages
from core.helper import encrypter
from core.plugin.impl.plugin import PluginInstaller
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.rag.models.document import Document
from core.tools.entities.tool_entities import CredentialType
from core.tools.utils.system_oauth_encryption import encrypt_system_oauth_params
from events.app_event import app_was_created
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from extensions.storage.storage_type import StorageType
from libs.helper import email as email_validate
from libs.password import hash_password, password_pattern, valid_password
from libs.rsa import generate_key_pair
from models import Tenant
from models.dataset import Dataset, DatasetCollectionBinding, DatasetMetadata, DatasetMetadataBinding, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.model import Account, App, AppAnnotationSetting, AppMode, Conversation, MessageAnnotation, UploadFile
from models.oauth import DatasourceOauthParamConfig, DatasourceProvider
from models.provider import Provider, ProviderModel
from models.provider_ids import DatasourceProviderID, ToolProviderID
from models.source import DataSourceApiKeyAuthBinding, DataSourceOauthBinding
from models.tools import ToolOAuthSystemClient
from services.account_service import AccountService, RegisterService, TenantService
from services.clear_free_plan_tenant_expired_logs import ClearFreePlanTenantExpiredLogs
from services.plugin.data_migration import PluginDataMigration
from services.plugin.plugin_migration import PluginMigration
from services.plugin.plugin_service import PluginService
from tasks.remove_app_and_related_data_task import delete_draft_variables_batch

logger = logging.getLogger(__name__)


@click.command("reset-password", help="Reset the account password.")
@click.option("--email", prompt=True, help="Account email to reset password for")
@click.option("--new-password", prompt=True, help="New password")
@click.option("--password-confirm", prompt=True, help="Confirm new password")
def reset_password(email, new_password, password_confirm):
    """
    Reset password of owner account
    Only available in SELF_HOSTED mode
    """
    if str(new_password).strip() != str(password_confirm).strip():
        click.echo(click.style("Passwords do not match.", fg="red"))
        return
    with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
        account = session.query(Account).where(Account.email == email).one_or_none()

        if not account:
            click.echo(click.style(f"Account not found for email: {email}", fg="red"))
            return

        try:
            valid_password(new_password)
        except:
            click.echo(click.style(f"Invalid password. Must match {password_pattern}", fg="red"))
            return

        # generate password salt
        salt = secrets.token_bytes(16)
        base64_salt = base64.b64encode(salt).decode()

        # encrypt password with salt
        password_hashed = hash_password(new_password, salt)
        base64_password_hashed = base64.b64encode(password_hashed).decode()
        account.password = base64_password_hashed
        account.password_salt = base64_salt
        AccountService.reset_login_error_rate_limit(email)
        click.echo(click.style("Password reset successfully.", fg="green"))


@click.command("reset-email", help="Reset the account email.")
@click.option("--email", prompt=True, help="Current account email")
@click.option("--new-email", prompt=True, help="New email")
@click.option("--email-confirm", prompt=True, help="Confirm new email")
def reset_email(email, new_email, email_confirm):
    """
    Replace account email
    :return:
    """
    if str(new_email).strip() != str(email_confirm).strip():
        click.echo(click.style("New emails do not match.", fg="red"))
        return
    with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
        account = session.query(Account).where(Account.email == email).one_or_none()

        if not account:
            click.echo(click.style(f"Account not found for email: {email}", fg="red"))
            return

        try:
            email_validate(new_email)
        except:
            click.echo(click.style(f"Invalid email: {new_email}", fg="red"))
            return

        account.email = new_email
        click.echo(click.style("Email updated successfully.", fg="green"))


@click.command(
    "reset-encrypt-key-pair",
    help="Reset the asymmetric key pair of workspace for encrypt LLM credentials. "
    "After the reset, all LLM credentials will become invalid, "
    "requiring re-entry."
    "Only support SELF_HOSTED mode.",
)
@click.confirmation_option(
    prompt=click.style(
        "Are you sure you want to reset encrypt key pair? This operation cannot be rolled back!", fg="red"
    )
)
def reset_encrypt_key_pair():
    """
    Reset the encrypted key pair of workspace for encrypt LLM credentials.
    After the reset, all LLM credentials will become invalid, requiring re-entry.
    Only support SELF_HOSTED mode.
    """
    if dify_config.EDITION != "SELF_HOSTED":
        click.echo(click.style("This command is only for SELF_HOSTED installations.", fg="red"))
        return
    with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
        tenants = session.query(Tenant).all()
        for tenant in tenants:
            if not tenant:
                click.echo(click.style("No workspaces found. Run /install first.", fg="red"))
                return

            tenant.encrypt_public_key = generate_key_pair(tenant.id)

            session.query(Provider).where(Provider.provider_type == "custom", Provider.tenant_id == tenant.id).delete()
            session.query(ProviderModel).where(ProviderModel.tenant_id == tenant.id).delete()

            click.echo(
                click.style(
                    f"Congratulations! The asymmetric key pair of workspace {tenant.id} has been reset.",
                    fg="green",
                )
            )


@click.command("vdb-migrate", help="Migrate vector db.")
@click.option("--scope", default="all", prompt=False, help="The scope of vector database to migrate, Default is All.")
def vdb_migrate(scope: str):
    if scope in {"knowledge", "all"}:
        migrate_knowledge_vector_database()
    if scope in {"annotation", "all"}:
        migrate_annotation_vector_database()


def migrate_annotation_vector_database():
    """
    Migrate annotation datas to target vector database .
    """
    click.echo(click.style("Starting annotation data migration.", fg="green"))
    create_count = 0
    skipped_count = 0
    total_count = 0
    page = 1
    while True:
        try:
            # get apps info
            per_page = 50
            with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
                apps = (
                    session.query(App)
                    .where(App.status == "normal")
                    .order_by(App.created_at.desc())
                    .limit(per_page)
                    .offset((page - 1) * per_page)
                    .all()
                )
            if not apps:
                break
        except SQLAlchemyError:
            raise

        page += 1
        for app in apps:
            total_count = total_count + 1
            click.echo(
                f"Processing the {total_count} app {app.id}. " + f"{create_count} created, {skipped_count} skipped."
            )
            try:
                click.echo(f"Creating app annotation index: {app.id}")
                with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
                    app_annotation_setting = (
                        session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app.id).first()
                    )

                    if not app_annotation_setting:
                        skipped_count = skipped_count + 1
                        click.echo(f"App annotation setting disabled: {app.id}")
                        continue
                    # get dataset_collection_binding info
                    dataset_collection_binding = (
                        session.query(DatasetCollectionBinding)
                        .where(DatasetCollectionBinding.id == app_annotation_setting.collection_binding_id)
                        .first()
                    )
                    if not dataset_collection_binding:
                        click.echo(f"App annotation collection binding not found: {app.id}")
                        continue
                    annotations = session.scalars(
                        select(MessageAnnotation).where(MessageAnnotation.app_id == app.id)
                    ).all()
                dataset = Dataset(
                    id=app.id,
                    tenant_id=app.tenant_id,
                    indexing_technique="high_quality",
                    embedding_model_provider=dataset_collection_binding.provider_name,
                    embedding_model=dataset_collection_binding.model_name,
                    collection_binding_id=dataset_collection_binding.id,
                )
                documents = []
                if annotations:
                    for annotation in annotations:
                        document = Document(
                            page_content=annotation.question,
                            metadata={"annotation_id": annotation.id, "app_id": app.id, "doc_id": annotation.id},
                        )
                        documents.append(document)

                vector = Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"])
                click.echo(f"Migrating annotations for app: {app.id}.")

                try:
                    vector.delete()
                    click.echo(click.style(f"Deleted vector index for app {app.id}.", fg="green"))
                except Exception as e:
                    click.echo(click.style(f"Failed to delete vector index for app {app.id}.", fg="red"))
                    raise e
                if documents:
                    try:
                        click.echo(
                            click.style(
                                f"Creating vector index with {len(documents)} annotations for app {app.id}.",
                                fg="green",
                            )
                        )
                        vector.create(documents)
                        click.echo(click.style(f"Created vector index for app {app.id}.", fg="green"))
                    except Exception as e:
                        click.echo(click.style(f"Failed to created vector index for app {app.id}.", fg="red"))
                        raise e
                click.echo(f"Successfully migrated app annotation {app.id}.")
                create_count += 1
            except Exception as e:
                click.echo(
                    click.style(f"Error creating app annotation index: {e.__class__.__name__} {str(e)}", fg="red")
                )
                continue

    click.echo(
        click.style(
            f"Migration complete. Created {create_count} app annotation indexes. Skipped {skipped_count} apps.",
            fg="green",
        )
    )


def migrate_knowledge_vector_database():
    """
    Migrate vector database datas to target vector database .
    """
    click.echo(click.style("Starting vector database migration.", fg="green"))
    create_count = 0
    skipped_count = 0
    total_count = 0
    vector_type = dify_config.VECTOR_STORE
    upper_collection_vector_types = {
        VectorType.MILVUS,
        VectorType.PGVECTOR,
        VectorType.VASTBASE,
        VectorType.RELYT,
        VectorType.WEAVIATE,
        VectorType.ORACLE,
        VectorType.ELASTICSEARCH,
        VectorType.OPENGAUSS,
        VectorType.TABLESTORE,
        VectorType.MATRIXONE,
    }
    lower_collection_vector_types = {
        VectorType.ANALYTICDB,
        VectorType.CHROMA,
        VectorType.MYSCALE,
        VectorType.PGVECTO_RS,
        VectorType.TIDB_VECTOR,
        VectorType.OPENSEARCH,
        VectorType.TENCENT,
        VectorType.BAIDU,
        VectorType.VIKINGDB,
        VectorType.UPSTASH,
        VectorType.COUCHBASE,
        VectorType.OCEANBASE,
    }
    page = 1
    while True:
        try:
            stmt = (
                select(Dataset).where(Dataset.indexing_technique == "high_quality").order_by(Dataset.created_at.desc())
            )

            datasets = db.paginate(select=stmt, page=page, per_page=50, max_per_page=50, error_out=False)
            if not datasets.items:
                break
        except SQLAlchemyError:
            raise

        page += 1
        for dataset in datasets:
            total_count = total_count + 1
            click.echo(
                f"Processing the {total_count} dataset {dataset.id}. {create_count} created, {skipped_count} skipped."
            )
            try:
                click.echo(f"Creating dataset vector database index: {dataset.id}")
                if dataset.index_struct_dict:
                    if dataset.index_struct_dict["type"] == vector_type:
                        skipped_count = skipped_count + 1
                        continue
                collection_name = ""
                dataset_id = dataset.id
                if vector_type in upper_collection_vector_types:
                    collection_name = Dataset.gen_collection_name_by_id(dataset_id)
                elif vector_type == VectorType.QDRANT:
                    if dataset.collection_binding_id:
                        dataset_collection_binding = (
                            db.session.query(DatasetCollectionBinding)
                            .where(DatasetCollectionBinding.id == dataset.collection_binding_id)
                            .one_or_none()
                        )
                        if dataset_collection_binding:
                            collection_name = dataset_collection_binding.collection_name
                        else:
                            raise ValueError("Dataset Collection Binding not found")
                    else:
                        collection_name = Dataset.gen_collection_name_by_id(dataset_id)

                elif vector_type in lower_collection_vector_types:
                    collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
                else:
                    raise ValueError(f"Vector store {vector_type} is not supported.")

                index_struct_dict = {"type": vector_type, "vector_store": {"class_prefix": collection_name}}
                dataset.index_struct = json.dumps(index_struct_dict)
                vector = Vector(dataset)
                click.echo(f"Migrating dataset {dataset.id}.")

                try:
                    vector.delete()
                    click.echo(
                        click.style(f"Deleted vector index {collection_name} for dataset {dataset.id}.", fg="green")
                    )
                except Exception as e:
                    click.echo(
                        click.style(
                            f"Failed to delete vector index {collection_name} for dataset {dataset.id}.", fg="red"
                        )
                    )
                    raise e

                dataset_documents = db.session.scalars(
                    select(DatasetDocument).where(
                        DatasetDocument.dataset_id == dataset.id,
                        DatasetDocument.indexing_status == "completed",
                        DatasetDocument.enabled == True,
                        DatasetDocument.archived == False,
                    )
                ).all()

                documents = []
                segments_count = 0
                for dataset_document in dataset_documents:
                    segments = db.session.scalars(
                        select(DocumentSegment).where(
                            DocumentSegment.document_id == dataset_document.id,
                            DocumentSegment.status == "completed",
                            DocumentSegment.enabled == True,
                        )
                    ).all()

                    for segment in segments:
                        document = Document(
                            page_content=segment.content,
                            metadata={
                                "doc_id": segment.index_node_id,
                                "doc_hash": segment.index_node_hash,
                                "document_id": segment.document_id,
                                "dataset_id": segment.dataset_id,
                            },
                        )

                        documents.append(document)
                        segments_count = segments_count + 1

                if documents:
                    try:
                        click.echo(
                            click.style(
                                f"Creating vector index with {len(documents)} documents of {segments_count}"
                                f" segments for dataset {dataset.id}.",
                                fg="green",
                            )
                        )
                        vector.create(documents)
                        click.echo(click.style(f"Created vector index for dataset {dataset.id}.", fg="green"))
                    except Exception as e:
                        click.echo(click.style(f"Failed to created vector index for dataset {dataset.id}.", fg="red"))
                        raise e
                db.session.add(dataset)
                db.session.commit()
                click.echo(f"Successfully migrated dataset {dataset.id}.")
                create_count += 1
            except Exception as e:
                db.session.rollback()
                click.echo(click.style(f"Error creating dataset index: {e.__class__.__name__} {str(e)}", fg="red"))
                continue

    click.echo(
        click.style(
            f"Migration complete. Created {create_count} dataset indexes. Skipped {skipped_count} datasets.", fg="green"
        )
    )


@click.command("convert-to-agent-apps", help="Convert Agent Assistant to Agent App.")
def convert_to_agent_apps():
    """
    Convert Agent Assistant to Agent App.
    """
    click.echo(click.style("Starting convert to agent apps.", fg="green"))

    proceeded_app_ids = []

    while True:
        # fetch first 1000 apps
        sql_query = """SELECT a.id AS id FROM apps a
            INNER JOIN app_model_configs am ON a.app_model_config_id=am.id
            WHERE a.mode = 'chat'
            AND am.agent_mode is not null
            AND (
                am.agent_mode like '%"strategy": "function_call"%'
                OR am.agent_mode  like '%"strategy": "react"%'
            )
            AND (
                am.agent_mode like '{"enabled": true%'
                OR am.agent_mode like '{"max_iteration": %'
            ) ORDER BY a.created_at DESC LIMIT 1000
        """

        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(sql_query))

            apps = []
            for i in rs:
                app_id = str(i.id)
                if app_id not in proceeded_app_ids:
                    proceeded_app_ids.append(app_id)
                    app = db.session.query(App).where(App.id == app_id).first()
                    if app is not None:
                        apps.append(app)

            if len(apps) == 0:
                break

        for app in apps:
            click.echo(f"Converting app: {app.id}")

            try:
                app.mode = AppMode.AGENT_CHAT
                db.session.commit()

                # update conversation mode to agent
                db.session.query(Conversation).where(Conversation.app_id == app.id).update(
                    {Conversation.mode: AppMode.AGENT_CHAT}
                )

                db.session.commit()
                click.echo(click.style(f"Converted app: {app.id}", fg="green"))
            except Exception as e:
                click.echo(click.style(f"Convert app error: {e.__class__.__name__} {str(e)}", fg="red"))

    click.echo(click.style(f"Conversion complete. Converted {len(proceeded_app_ids)} agent apps.", fg="green"))


@click.command("add-qdrant-index", help="Add Qdrant index.")
@click.option("--field", default="metadata.doc_id", prompt=False, help="Index field , default is metadata.doc_id.")
def add_qdrant_index(field: str):
    click.echo(click.style("Starting Qdrant index creation.", fg="green"))

    create_count = 0

    try:
        bindings = db.session.query(DatasetCollectionBinding).all()
        if not bindings:
            click.echo(click.style("No dataset collection bindings found.", fg="red"))
            return
        import qdrant_client
        from qdrant_client.http.exceptions import UnexpectedResponse
        from qdrant_client.http.models import PayloadSchemaType

        from core.rag.datasource.vdb.qdrant.qdrant_vector import PathQdrantParams, QdrantConfig

        for binding in bindings:
            if dify_config.QDRANT_URL is None:
                raise ValueError("Qdrant URL is required.")
            qdrant_config = QdrantConfig(
                endpoint=dify_config.QDRANT_URL,
                api_key=dify_config.QDRANT_API_KEY,
                root_path=current_app.root_path,
                timeout=dify_config.QDRANT_CLIENT_TIMEOUT,
                grpc_port=dify_config.QDRANT_GRPC_PORT,
                prefer_grpc=dify_config.QDRANT_GRPC_ENABLED,
            )
            try:
                params = qdrant_config.to_qdrant_params()
                # Check the type before using
                if isinstance(params, PathQdrantParams):
                    # PathQdrantParams case
                    client = qdrant_client.QdrantClient(path=params.path)
                else:
                    # UrlQdrantParams case - params is UrlQdrantParams
                    client = qdrant_client.QdrantClient(
                        url=params.url,
                        api_key=params.api_key,
                        timeout=int(params.timeout),
                        verify=params.verify,
                        grpc_port=params.grpc_port,
                        prefer_grpc=params.prefer_grpc,
                    )
                # create payload index
                client.create_payload_index(binding.collection_name, field, field_schema=PayloadSchemaType.KEYWORD)
                create_count += 1
            except UnexpectedResponse as e:
                # Collection does not exist, so return
                if e.status_code == 404:
                    click.echo(click.style(f"Collection not found: {binding.collection_name}.", fg="red"))
                    continue
                # Some other error occurred, so re-raise the exception
                else:
                    click.echo(
                        click.style(
                            f"Failed to create Qdrant index for collection: {binding.collection_name}.", fg="red"
                        )
                    )

    except Exception:
        click.echo(click.style("Failed to create Qdrant client.", fg="red"))

    click.echo(click.style(f"Index creation complete. Created {create_count} collection indexes.", fg="green"))


@click.command("old-metadata-migration", help="Old metadata migration.")
def old_metadata_migration():
    """
    Old metadata migration.
    """
    click.echo(click.style("Starting old metadata migration.", fg="green"))

    page = 1
    while True:
        try:
            stmt = (
                select(DatasetDocument)
                .where(DatasetDocument.doc_metadata.is_not(None))
                .order_by(DatasetDocument.created_at.desc())
            )
            documents = db.paginate(select=stmt, page=page, per_page=50, max_per_page=50, error_out=False)
        except SQLAlchemyError:
            raise
        if not documents:
            break
        for document in documents:
            if document.doc_metadata:
                doc_metadata = document.doc_metadata
                for key in doc_metadata:
                    for field in BuiltInField:
                        if field.value == key:
                            break
                    else:
                        dataset_metadata = (
                            db.session.query(DatasetMetadata)
                            .where(DatasetMetadata.dataset_id == document.dataset_id, DatasetMetadata.name == key)
                            .first()
                        )
                        if not dataset_metadata:
                            dataset_metadata = DatasetMetadata(
                                tenant_id=document.tenant_id,
                                dataset_id=document.dataset_id,
                                name=key,
                                type="string",
                                created_by=document.created_by,
                            )
                            db.session.add(dataset_metadata)
                            db.session.flush()
                            dataset_metadata_binding = DatasetMetadataBinding(
                                tenant_id=document.tenant_id,
                                dataset_id=document.dataset_id,
                                metadata_id=dataset_metadata.id,
                                document_id=document.id,
                                created_by=document.created_by,
                            )
                            db.session.add(dataset_metadata_binding)
                        else:
                            dataset_metadata_binding = (
                                db.session.query(DatasetMetadataBinding)  # type: ignore
                                .where(
                                    DatasetMetadataBinding.dataset_id == document.dataset_id,
                                    DatasetMetadataBinding.document_id == document.id,
                                    DatasetMetadataBinding.metadata_id == dataset_metadata.id,
                                )
                                .first()
                            )
                            if not dataset_metadata_binding:
                                dataset_metadata_binding = DatasetMetadataBinding(
                                    tenant_id=document.tenant_id,
                                    dataset_id=document.dataset_id,
                                    metadata_id=dataset_metadata.id,
                                    document_id=document.id,
                                    created_by=document.created_by,
                                )
                                db.session.add(dataset_metadata_binding)
                        db.session.commit()
        page += 1
    click.echo(click.style("Old metadata migration completed.", fg="green"))


@click.command("create-tenant", help="Create account and tenant.")
@click.option("--email", prompt=True, help="Tenant account email.")
@click.option("--name", prompt=True, help="Workspace name.")
@click.option("--language", prompt=True, help="Account language, default: en-US.")
def create_tenant(email: str, language: str | None = None, name: str | None = None):
    """
    Create tenant account
    """
    if not email:
        click.echo(click.style("Email is required.", fg="red"))
        return

    # Create account
    email = email.strip()

    if "@" not in email:
        click.echo(click.style("Invalid email address.", fg="red"))
        return

    account_name = email.split("@")[0]

    if language not in languages:
        language = "en-US"

    # Validates name encoding for non-Latin characters.
    name = name.strip().encode("utf-8").decode("utf-8") if name else None

    # generate random password
    new_password = secrets.token_urlsafe(16)

    # register account
    account = RegisterService.register(
        email=email,
        name=account_name,
        password=new_password,
        language=language,
        create_workspace_required=False,
    )
    TenantService.create_owner_tenant_if_not_exist(account, name)

    click.echo(
        click.style(
            f"Account and tenant created.\nAccount: {email}\nPassword: {new_password}",
            fg="green",
        )
    )


@click.command("upgrade-db", help="Upgrade the database")
def upgrade_db():
    click.echo("Preparing database migration...")
    lock = redis_client.lock(name="db_upgrade_lock", timeout=60)
    if lock.acquire(blocking=False):
        try:
            click.echo(click.style("Starting database migration.", fg="green"))

            # run db migration
            import flask_migrate

            flask_migrate.upgrade()

            click.echo(click.style("Database migration successful!", fg="green"))

        except Exception:
            logger.exception("Failed to execute database migration")
        finally:
            lock.release()
    else:
        click.echo("Database migration skipped")


@click.command("fix-app-site-missing", help="Fix app related site missing issue.")
def fix_app_site_missing():
    """
    Fix app related site missing issue.
    """
    click.echo(click.style("Starting fix for missing app-related sites.", fg="green"))

    failed_app_ids = []
    while True:
        sql = """select apps.id as id from apps left join sites on sites.app_id=apps.id
where sites.id is null limit 1000"""
        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(sql))

            processed_count = 0
            for i in rs:
                processed_count += 1
                app_id = str(i.id)

                if app_id in failed_app_ids:
                    continue

                try:
                    app = db.session.query(App).where(App.id == app_id).first()
                    if not app:
                        logger.info("App %s not found", app_id)
                        continue

                    tenant = app.tenant
                    if tenant:
                        accounts = tenant.get_accounts()
                        if not accounts:
                            logger.info("Fix failed for app %s", app.id)
                            continue

                        account = accounts[0]
                        logger.info("Fixing missing site for app %s", app.id)
                        app_was_created.send(app, account=account)
                except Exception:
                    failed_app_ids.append(app_id)
                    click.echo(click.style(f"Failed to fix missing site for app {app_id}", fg="red"))
                    logger.exception("Failed to fix app related site missing issue, app_id: %s", app_id)
                    continue

            if not processed_count:
                break

    click.echo(click.style("Fix for missing app-related sites completed successfully!", fg="green"))


@click.command("migrate-data-for-plugin", help="Migrate data for plugin.")
def migrate_data_for_plugin():
    """
    Migrate data for plugin.
    """
    click.echo(click.style("Starting migrate data for plugin.", fg="white"))

    PluginDataMigration.migrate()

    click.echo(click.style("Migrate data for plugin completed.", fg="green"))


@click.command("extract-plugins", help="Extract plugins.")
@click.option("--output_file", prompt=True, help="The file to store the extracted plugins.", default="plugins.jsonl")
@click.option("--workers", prompt=True, help="The number of workers to extract plugins.", default=10)
def extract_plugins(output_file: str, workers: int):
    """
    Extract plugins.
    """
    click.echo(click.style("Starting extract plugins.", fg="white"))

    PluginMigration.extract_plugins(output_file, workers)

    click.echo(click.style("Extract plugins completed.", fg="green"))


@click.command("extract-unique-identifiers", help="Extract unique identifiers.")
@click.option(
    "--output_file",
    prompt=True,
    help="The file to store the extracted unique identifiers.",
    default="unique_identifiers.json",
)
@click.option(
    "--input_file", prompt=True, help="The file to store the extracted unique identifiers.", default="plugins.jsonl"
)
def extract_unique_plugins(output_file: str, input_file: str):
    """
    Extract unique plugins.
    """
    click.echo(click.style("Starting extract unique plugins.", fg="white"))

    PluginMigration.extract_unique_plugins_to_file(input_file, output_file)

    click.echo(click.style("Extract unique plugins completed.", fg="green"))


@click.command("install-plugins", help="Install plugins.")
@click.option(
    "--input_file", prompt=True, help="The file to store the extracted unique identifiers.", default="plugins.jsonl"
)
@click.option(
    "--output_file", prompt=True, help="The file to store the installed plugins.", default="installed_plugins.jsonl"
)
@click.option("--workers", prompt=True, help="The number of workers to install plugins.", default=100)
def install_plugins(input_file: str, output_file: str, workers: int):
    """
    Install plugins.
    """
    click.echo(click.style("Starting install plugins.", fg="white"))

    PluginMigration.install_plugins(input_file, output_file, workers)

    click.echo(click.style("Install plugins completed.", fg="green"))


@click.command("clear-free-plan-tenant-expired-logs", help="Clear free plan tenant expired logs.")
@click.option("--days", prompt=True, help="The days to clear free plan tenant expired logs.", default=30)
@click.option("--batch", prompt=True, help="The batch size to clear free plan tenant expired logs.", default=100)
@click.option(
    "--tenant_ids",
    prompt=True,
    multiple=True,
    help="The tenant ids to clear free plan tenant expired logs.",
)
def clear_free_plan_tenant_expired_logs(days: int, batch: int, tenant_ids: list[str]):
    """
    Clear free plan tenant expired logs.
    """
    click.echo(click.style("Starting clear free plan tenant expired logs.", fg="white"))

    ClearFreePlanTenantExpiredLogs.process(days, batch, tenant_ids)

    click.echo(click.style("Clear free plan tenant expired logs completed.", fg="green"))


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
            if ids_table["type"] == "uuid":
                click.echo(
                    click.style(
                        f"- Listing file ids in column {ids_table['column']} in table {ids_table['table']}", fg="white"
                    )
                )
                query = (
                    f"SELECT {ids_table['column']} FROM {ids_table['table']} WHERE {ids_table['column']} IS NOT NULL"
                )
                with db.engine.begin() as conn:
                    rs = conn.execute(sa.text(query))
                for i in rs:
                    all_ids_in_tables.append({"table": ids_table["table"], "id": str(i[0])})
            elif ids_table["type"] == "text":
                click.echo(
                    click.style(
                        f"- Listing file-id-like strings in column {ids_table['column']} in table {ids_table['table']}",
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
            elif ids_table["type"] == "json":
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

    all_files_on_storage = []
    for storage_path in storage_paths:
        try:
            click.echo(click.style(f"- Scanning files on storage path {storage_path}", fg="white"))
            files = storage.scan(path=storage_path, files=True, directories=False)
            all_files_on_storage.extend(files)
        except FileNotFoundError as e:
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


@click.command("setup-system-tool-oauth-client", help="Setup system tool oauth client.")
@click.option("--provider", prompt=True, help="Provider name")
@click.option("--client-params", prompt=True, help="Client Params")
def setup_system_tool_oauth_client(provider, client_params):
    """
    Setup system tool oauth client
    """
    provider_id = ToolProviderID(provider)
    provider_name = provider_id.provider_name
    plugin_id = provider_id.plugin_id

    try:
        # json validate
        click.echo(click.style(f"Validating client params: {client_params}", fg="yellow"))
        client_params_dict = TypeAdapter(dict[str, Any]).validate_json(client_params)
        click.echo(click.style("Client params validated successfully.", fg="green"))

        click.echo(click.style(f"Encrypting client params: {client_params}", fg="yellow"))
        click.echo(click.style(f"Using SECRET_KEY: `{dify_config.SECRET_KEY}`", fg="yellow"))
        oauth_client_params = encrypt_system_oauth_params(client_params_dict)
        click.echo(click.style("Client params encrypted successfully.", fg="green"))
    except Exception as e:
        click.echo(click.style(f"Error parsing client params: {str(e)}", fg="red"))
        return

    deleted_count = (
        db.session.query(ToolOAuthSystemClient)
        .filter_by(
            provider=provider_name,
            plugin_id=plugin_id,
        )
        .delete()
    )
    if deleted_count > 0:
        click.echo(click.style(f"Deleted {deleted_count} existing oauth client params.", fg="yellow"))

    oauth_client = ToolOAuthSystemClient(
        provider=provider_name,
        plugin_id=plugin_id,
        encrypted_oauth_params=oauth_client_params,
    )
    db.session.add(oauth_client)
    db.session.commit()
    click.echo(click.style(f"OAuth client params setup successfully. id: {oauth_client.id}", fg="green"))


def _find_orphaned_draft_variables(batch_size: int = 1000) -> list[str]:
    """
    Find draft variables that reference non-existent apps.

    Args:
        batch_size: Maximum number of orphaned app IDs to return

    Returns:
        List of app IDs that have draft variables but don't exist in the apps table
    """
    query = """
        SELECT DISTINCT wdv.app_id
        FROM workflow_draft_variables AS wdv
        WHERE NOT EXISTS(
            SELECT 1 FROM apps WHERE apps.id = wdv.app_id
        )
        LIMIT :batch_size
    """

    with db.engine.connect() as conn:
        result = conn.execute(sa.text(query), {"batch_size": batch_size})
        return [row[0] for row in result]


def _count_orphaned_draft_variables() -> dict[str, Any]:
    """
    Count orphaned draft variables by app, including associated file counts.

    Returns:
        Dictionary with statistics about orphaned variables and files
    """
    # Count orphaned variables by app
    variables_query = """
        SELECT
            wdv.app_id,
            COUNT(*) as variable_count,
            COUNT(wdv.file_id) as file_count
        FROM workflow_draft_variables AS wdv
        WHERE NOT EXISTS(
            SELECT 1 FROM apps WHERE apps.id = wdv.app_id
        )
        GROUP BY wdv.app_id
        ORDER BY variable_count DESC
    """

    with db.engine.connect() as conn:
        result = conn.execute(sa.text(variables_query))
        orphaned_by_app = {}
        total_files = 0

        for row in result:
            app_id, variable_count, file_count = row
            orphaned_by_app[app_id] = {"variables": variable_count, "files": file_count}
            total_files += file_count

        total_orphaned = sum(app_data["variables"] for app_data in orphaned_by_app.values())
        app_count = len(orphaned_by_app)

        return {
            "total_orphaned_variables": total_orphaned,
            "total_orphaned_files": total_files,
            "orphaned_app_count": app_count,
            "orphaned_by_app": orphaned_by_app,
        }


@click.command()
@click.option("--dry-run", is_flag=True, help="Show what would be deleted without actually deleting")
@click.option("--batch-size", default=1000, help="Number of records to process per batch (default 1000)")
@click.option("--max-apps", default=None, type=int, help="Maximum number of apps to process (default: no limit)")
@click.option("-f", "--force", is_flag=True, help="Skip user confirmation and force the command to execute.")
def cleanup_orphaned_draft_variables(
    dry_run: bool,
    batch_size: int,
    max_apps: int | None,
    force: bool = False,
):
    """
    Clean up orphaned draft variables from the database.

    This script finds and removes draft variables that belong to apps
    that no longer exist in the database.
    """
    logger = logging.getLogger(__name__)

    # Get statistics
    stats = _count_orphaned_draft_variables()

    logger.info("Found %s orphaned draft variables", stats["total_orphaned_variables"])
    logger.info("Found %s associated offload files", stats["total_orphaned_files"])
    logger.info("Across %s non-existent apps", stats["orphaned_app_count"])

    if stats["total_orphaned_variables"] == 0:
        logger.info("No orphaned draft variables found. Exiting.")
        return

    if dry_run:
        logger.info("DRY RUN: Would delete the following:")
        for app_id, data in sorted(stats["orphaned_by_app"].items(), key=lambda x: x[1]["variables"], reverse=True)[
            :10
        ]:  # Show top 10
            logger.info("  App %s: %s variables, %s files", app_id, data["variables"], data["files"])
        if len(stats["orphaned_by_app"]) > 10:
            logger.info("  ... and %s more apps", len(stats["orphaned_by_app"]) - 10)
        return

    # Confirm deletion
    if not force:
        click.confirm(
            f"Are you sure you want to delete {stats['total_orphaned_variables']} "
            f"orphaned draft variables and {stats['total_orphaned_files']} associated files "
            f"from {stats['orphaned_app_count']} apps?",
            abort=True,
        )

    total_deleted = 0
    processed_apps = 0

    while True:
        if max_apps and processed_apps >= max_apps:
            logger.info("Reached maximum app limit (%s). Stopping.", max_apps)
            break

        orphaned_app_ids = _find_orphaned_draft_variables(batch_size=10)
        if not orphaned_app_ids:
            logger.info("No more orphaned draft variables found.")
            break

        for app_id in orphaned_app_ids:
            if max_apps and processed_apps >= max_apps:
                break

            try:
                deleted_count = delete_draft_variables_batch(app_id, batch_size)
                total_deleted += deleted_count
                processed_apps += 1

                logger.info("Deleted %s variables for app %s", deleted_count, app_id)

            except Exception:
                logger.exception("Error processing app %s", app_id)
                continue

    logger.info("Cleanup completed. Total deleted: %s variables across %s apps", total_deleted, processed_apps)


@click.command("setup-datasource-oauth-client", help="Setup datasource oauth client.")
@click.option("--provider", prompt=True, help="Provider name")
@click.option("--client-params", prompt=True, help="Client Params")
def setup_datasource_oauth_client(provider, client_params):
    """
    Setup datasource oauth client
    """
    provider_id = DatasourceProviderID(provider)
    provider_name = provider_id.provider_name
    plugin_id = provider_id.plugin_id

    try:
        # json validate
        click.echo(click.style(f"Validating client params: {client_params}", fg="yellow"))
        client_params_dict = TypeAdapter(dict[str, Any]).validate_json(client_params)
        click.echo(click.style("Client params validated successfully.", fg="green"))
    except Exception as e:
        click.echo(click.style(f"Error parsing client params: {str(e)}", fg="red"))
        return

    click.echo(click.style(f"Ready to delete existing oauth client params: {provider_name}", fg="yellow"))
    deleted_count = (
        db.session.query(DatasourceOauthParamConfig)
        .filter_by(
            provider=provider_name,
            plugin_id=plugin_id,
        )
        .delete()
    )
    if deleted_count > 0:
        click.echo(click.style(f"Deleted {deleted_count} existing oauth client params.", fg="yellow"))

    click.echo(click.style(f"Ready to setup datasource oauth client: {provider_name}", fg="yellow"))
    oauth_client = DatasourceOauthParamConfig(
        provider=provider_name,
        plugin_id=plugin_id,
        system_credentials=client_params_dict,
    )
    db.session.add(oauth_client)
    db.session.commit()
    click.echo(click.style(f"provider: {provider_name}", fg="green"))
    click.echo(click.style(f"plugin_id: {plugin_id}", fg="green"))
    click.echo(click.style(f"params: {json.dumps(client_params_dict, indent=2, ensure_ascii=False)}", fg="green"))
    click.echo(click.style(f"Datasource oauth client setup successfully. id: {oauth_client.id}", fg="green"))


@click.command("transform-datasource-credentials", help="Transform datasource credentials.")
def transform_datasource_credentials():
    """
    Transform datasource credentials
    """
    try:
        installer_manager = PluginInstaller()
        plugin_migration = PluginMigration()

        notion_plugin_id = "langgenius/notion_datasource"
        firecrawl_plugin_id = "langgenius/firecrawl_datasource"
        jina_plugin_id = "langgenius/jina_datasource"
        notion_plugin_unique_identifier = plugin_migration._fetch_plugin_unique_identifier(notion_plugin_id)  # pyright: ignore[reportPrivateUsage]
        firecrawl_plugin_unique_identifier = plugin_migration._fetch_plugin_unique_identifier(firecrawl_plugin_id)  # pyright: ignore[reportPrivateUsage]
        jina_plugin_unique_identifier = plugin_migration._fetch_plugin_unique_identifier(jina_plugin_id)  # pyright: ignore[reportPrivateUsage]
        oauth_credential_type = CredentialType.OAUTH2
        api_key_credential_type = CredentialType.API_KEY

        # deal notion credentials
        deal_notion_count = 0
        notion_credentials = db.session.query(DataSourceOauthBinding).filter_by(provider="notion").all()
        if notion_credentials:
            notion_credentials_tenant_mapping: dict[str, list[DataSourceOauthBinding]] = {}
            for notion_credential in notion_credentials:
                tenant_id = notion_credential.tenant_id
                if tenant_id not in notion_credentials_tenant_mapping:
                    notion_credentials_tenant_mapping[tenant_id] = []
                notion_credentials_tenant_mapping[tenant_id].append(notion_credential)
            for tenant_id, notion_tenant_credentials in notion_credentials_tenant_mapping.items():
                tenant = db.session.query(Tenant).filter_by(id=tenant_id).first()
                if not tenant:
                    continue
                try:
                    # check notion plugin is installed
                    installed_plugins = installer_manager.list_plugins(tenant_id)
                    installed_plugins_ids = [plugin.plugin_id for plugin in installed_plugins]
                    if notion_plugin_id not in installed_plugins_ids:
                        if notion_plugin_unique_identifier:
                            # install notion plugin
                            PluginService.install_from_marketplace_pkg(tenant_id, [notion_plugin_unique_identifier])
                    auth_count = 0
                    for notion_tenant_credential in notion_tenant_credentials:
                        auth_count += 1
                        # get credential oauth params
                        access_token = notion_tenant_credential.access_token
                        # notion info
                        notion_info = notion_tenant_credential.source_info
                        workspace_id = notion_info.get("workspace_id")
                        workspace_name = notion_info.get("workspace_name")
                        workspace_icon = notion_info.get("workspace_icon")
                        new_credentials = {
                            "integration_secret": encrypter.encrypt_token(tenant_id, access_token),
                            "workspace_id": workspace_id,
                            "workspace_name": workspace_name,
                            "workspace_icon": workspace_icon,
                        }
                        datasource_provider = DatasourceProvider(
                            provider="notion_datasource",
                            tenant_id=tenant_id,
                            plugin_id=notion_plugin_id,
                            auth_type=oauth_credential_type.value,
                            encrypted_credentials=new_credentials,
                            name=f"Auth {auth_count}",
                            avatar_url=workspace_icon or "default",
                            is_default=False,
                        )
                        db.session.add(datasource_provider)
                        deal_notion_count += 1
                except Exception as e:
                    click.echo(
                        click.style(
                            f"Error transforming notion credentials: {str(e)}, tenant_id: {tenant_id}", fg="red"
                        )
                    )
                    continue
                db.session.commit()
        # deal firecrawl credentials
        deal_firecrawl_count = 0
        firecrawl_credentials = db.session.query(DataSourceApiKeyAuthBinding).filter_by(provider="firecrawl").all()
        if firecrawl_credentials:
            firecrawl_credentials_tenant_mapping: dict[str, list[DataSourceApiKeyAuthBinding]] = {}
            for firecrawl_credential in firecrawl_credentials:
                tenant_id = firecrawl_credential.tenant_id
                if tenant_id not in firecrawl_credentials_tenant_mapping:
                    firecrawl_credentials_tenant_mapping[tenant_id] = []
                firecrawl_credentials_tenant_mapping[tenant_id].append(firecrawl_credential)
            for tenant_id, firecrawl_tenant_credentials in firecrawl_credentials_tenant_mapping.items():
                tenant = db.session.query(Tenant).filter_by(id=tenant_id).first()
                if not tenant:
                    continue
                try:
                    # check firecrawl plugin is installed
                    installed_plugins = installer_manager.list_plugins(tenant_id)
                    installed_plugins_ids = [plugin.plugin_id for plugin in installed_plugins]
                    if firecrawl_plugin_id not in installed_plugins_ids:
                        if firecrawl_plugin_unique_identifier:
                            # install firecrawl plugin
                            PluginService.install_from_marketplace_pkg(tenant_id, [firecrawl_plugin_unique_identifier])

                    auth_count = 0
                    for firecrawl_tenant_credential in firecrawl_tenant_credentials:
                        auth_count += 1
                        if not firecrawl_tenant_credential.credentials:
                            click.echo(
                                click.style(
                                    f"Skipping firecrawl credential for tenant {tenant_id} due to missing credentials.",
                                    fg="yellow",
                                )
                            )
                            continue
                        # get credential api key
                        credentials_json = json.loads(firecrawl_tenant_credential.credentials)
                        api_key = credentials_json.get("config", {}).get("api_key")
                        base_url = credentials_json.get("config", {}).get("base_url")
                        new_credentials = {
                            "firecrawl_api_key": api_key,
                            "base_url": base_url,
                        }
                        datasource_provider = DatasourceProvider(
                            provider="firecrawl",
                            tenant_id=tenant_id,
                            plugin_id=firecrawl_plugin_id,
                            auth_type=api_key_credential_type.value,
                            encrypted_credentials=new_credentials,
                            name=f"Auth {auth_count}",
                            avatar_url="default",
                            is_default=False,
                        )
                        db.session.add(datasource_provider)
                        deal_firecrawl_count += 1
                except Exception as e:
                    click.echo(
                        click.style(
                            f"Error transforming firecrawl credentials: {str(e)}, tenant_id: {tenant_id}", fg="red"
                        )
                    )
                    continue
                db.session.commit()
        # deal jina credentials
        deal_jina_count = 0
        jina_credentials = db.session.query(DataSourceApiKeyAuthBinding).filter_by(provider="jinareader").all()
        if jina_credentials:
            jina_credentials_tenant_mapping: dict[str, list[DataSourceApiKeyAuthBinding]] = {}
            for jina_credential in jina_credentials:
                tenant_id = jina_credential.tenant_id
                if tenant_id not in jina_credentials_tenant_mapping:
                    jina_credentials_tenant_mapping[tenant_id] = []
                jina_credentials_tenant_mapping[tenant_id].append(jina_credential)
            for tenant_id, jina_tenant_credentials in jina_credentials_tenant_mapping.items():
                tenant = db.session.query(Tenant).filter_by(id=tenant_id).first()
                if not tenant:
                    continue
                try:
                    # check jina plugin is installed
                    installed_plugins = installer_manager.list_plugins(tenant_id)
                    installed_plugins_ids = [plugin.plugin_id for plugin in installed_plugins]
                    if jina_plugin_id not in installed_plugins_ids:
                        if jina_plugin_unique_identifier:
                            # install jina plugin
                            logger.debug("Installing Jina plugin %s", jina_plugin_unique_identifier)
                            PluginService.install_from_marketplace_pkg(tenant_id, [jina_plugin_unique_identifier])

                    auth_count = 0
                    for jina_tenant_credential in jina_tenant_credentials:
                        auth_count += 1
                        if not jina_tenant_credential.credentials:
                            click.echo(
                                click.style(
                                    f"Skipping jina credential for tenant {tenant_id} due to missing credentials.",
                                    fg="yellow",
                                )
                            )
                            continue
                        # get credential api key
                        credentials_json = json.loads(jina_tenant_credential.credentials)
                        api_key = credentials_json.get("config", {}).get("api_key")
                        new_credentials = {
                            "integration_secret": api_key,
                        }
                        datasource_provider = DatasourceProvider(
                            provider="jina",
                            tenant_id=tenant_id,
                            plugin_id=jina_plugin_id,
                            auth_type=api_key_credential_type.value,
                            encrypted_credentials=new_credentials,
                            name=f"Auth {auth_count}",
                            avatar_url="default",
                            is_default=False,
                        )
                        db.session.add(datasource_provider)
                        deal_jina_count += 1
                except Exception as e:
                    click.echo(
                        click.style(f"Error transforming jina credentials: {str(e)}, tenant_id: {tenant_id}", fg="red")
                    )
                    continue
                db.session.commit()
    except Exception as e:
        click.echo(click.style(f"Error parsing client params: {str(e)}", fg="red"))
        return
    click.echo(click.style(f"Transforming notion successfully. deal_notion_count: {deal_notion_count}", fg="green"))
    click.echo(
        click.style(f"Transforming firecrawl successfully. deal_firecrawl_count: {deal_firecrawl_count}", fg="green")
    )
    click.echo(click.style(f"Transforming jina successfully. deal_jina_count: {deal_jina_count}", fg="green"))


@click.command("install-rag-pipeline-plugins", help="Install rag pipeline plugins.")
@click.option(
    "--input_file", prompt=True, help="The file to store the extracted unique identifiers.", default="plugins.jsonl"
)
@click.option(
    "--output_file", prompt=True, help="The file to store the installed plugins.", default="installed_plugins.jsonl"
)
@click.option("--workers", prompt=True, help="The number of workers to install plugins.", default=100)
def install_rag_pipeline_plugins(input_file, output_file, workers):
    """
    Install rag pipeline plugins
    """
    click.echo(click.style("Installing rag pipeline plugins", fg="yellow"))
    plugin_migration = PluginMigration()
    plugin_migration.install_rag_pipeline_plugins(
        input_file,
        output_file,
        workers,
    )
    click.echo(click.style("Installing rag pipeline plugins successfully", fg="green"))


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
                updated = (
                    db.session.query(UploadFile)
                    .where(
                        UploadFile.storage_type == source_storage_type,
                        UploadFile.key.in_(copied_upload_file_keys),
                    )
                    .update({UploadFile.storage_type: dify_config.STORAGE_TYPE}, synchronize_session=False)
                )
                db.session.commit()
                click.echo(click.style(f"Updated storage_type for {updated} upload_files records.", fg="green"))
            except Exception as e:
                db.session.rollback()
                click.echo(click.style(f"Failed to update DB storage_type: {str(e)}", fg="red"))
