import base64
import json
import logging
import secrets
from typing import Optional

import click
from configs import dify_config
from constants.languages import languages
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.models.document import Document
from events.app_event import app_was_created
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from flask import current_app
from libs.helper import email as email_validate
from libs.password import hash_password, password_pattern, valid_password
from libs.rsa import generate_key_pair
from models import Account, Tenant, TenantAccountJoin, TenantAccountJoinRole
from models.dataset import Dataset, DatasetCollectionBinding
from models.dataset import Document as DatasetDocument
from models.dataset import DocumentSegment
from models.model import App, AppAnnotationSetting, AppMode, Conversation, MessageAnnotation
from models.provider import Provider, ProviderModel
from services.account_service import RegisterService, TenantService
from werkzeug.exceptions import NotFound


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

    account = db.session.query(Account).filter(Account.email == email).one_or_none()

    if not account:
        click.echo(click.style("Account not found for email: {}".format(email), fg="red"))
        return

    try:
        valid_password(new_password)
    except:
        click.echo(click.style("Invalid password. Must match {}".format(password_pattern), fg="red"))
        return

    # generate password salt
    salt = secrets.token_bytes(16)
    base64_salt = base64.b64encode(salt).decode()

    # encrypt password with salt
    password_hashed = hash_password(new_password, salt)
    base64_password_hashed = base64.b64encode(password_hashed).decode()
    account.password = base64_password_hashed
    account.password_salt = base64_salt
    db.session.commit()
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

    account = db.session.query(Account).filter(Account.email == email).one_or_none()

    if not account:
        click.echo(click.style("Account not found for email: {}".format(email), fg="red"))
        return

    try:
        email_validate(new_email)
    except:
        click.echo(click.style("Invalid email: {}".format(new_email), fg="red"))
        return

    account.email = new_email
    db.session.commit()
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

    tenants = db.session.query(Tenant).all()
    for tenant in tenants:
        if not tenant:
            click.echo(click.style("No workspaces found. Run /install first.", fg="red"))
            return

        tenant.encrypt_public_key = generate_key_pair(tenant.id)

        db.session.query(Provider).filter(Provider.provider_type == "custom", Provider.tenant_id == tenant.id).delete()
        db.session.query(ProviderModel).filter(ProviderModel.tenant_id == tenant.id).delete()
        db.session.commit()

        click.echo(
            click.style(
                "Congratulations! The asymmetric key pair of workspace {} has been reset.".format(tenant.id),
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
            apps = (
                App.query.filter(App.status == "normal")
                .order_by(App.created_at.desc())
                .paginate(page=page, per_page=50)
            )
        except NotFound:
            break

        page += 1
        for app in apps:
            total_count = total_count + 1
            click.echo(
                f"Processing the {total_count} app {app.id}. " + f"{create_count} created, {skipped_count} skipped."
            )
            try:
                click.echo("Creating app annotation index: {}".format(app.id))
                app_annotation_setting = (
                    db.session.query(AppAnnotationSetting).filter(AppAnnotationSetting.app_id == app.id).first()
                )

                if not app_annotation_setting:
                    skipped_count = skipped_count + 1
                    click.echo("App annotation setting disabled: {}".format(app.id))
                    continue
                # get dataset_collection_binding info
                dataset_collection_binding = (
                    db.session.query(DatasetCollectionBinding)
                    .filter(DatasetCollectionBinding.id == app_annotation_setting.collection_binding_id)
                    .first()
                )
                if not dataset_collection_binding:
                    click.echo("App annotation collection binding not found: {}".format(app.id))
                    continue
                annotations = db.session.query(MessageAnnotation).filter(MessageAnnotation.app_id == app.id).all()
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
                    click.style(
                        "Error creating app annotation index: {} {}".format(e.__class__.__name__, str(e)), fg="red"
                    )
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
        VectorType.RELYT,
        VectorType.WEAVIATE,
        VectorType.ORACLE,
        VectorType.ELASTICSEARCH,
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
            datasets = (
                Dataset.query.filter(Dataset.indexing_technique == "high_quality")
                .order_by(Dataset.created_at.desc())
                .paginate(page=page, per_page=50)
            )
        except NotFound:
            break

        page += 1
        for dataset in datasets:
            total_count = total_count + 1
            click.echo(
                f"Processing the {total_count} dataset {dataset.id}. {create_count} created, {skipped_count} skipped."
            )
            try:
                click.echo("Creating dataset vector database index: {}".format(dataset.id))
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
                            .filter(DatasetCollectionBinding.id == dataset.collection_binding_id)
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

                dataset_documents = (
                    db.session.query(DatasetDocument)
                    .filter(
                        DatasetDocument.dataset_id == dataset.id,
                        DatasetDocument.indexing_status == "completed",
                        DatasetDocument.enabled == True,
                        DatasetDocument.archived == False,
                    )
                    .all()
                )

                documents = []
                segments_count = 0
                for dataset_document in dataset_documents:
                    segments = (
                        db.session.query(DocumentSegment)
                        .filter(
                            DocumentSegment.document_id == dataset_document.id,
                            DocumentSegment.status == "completed",
                            DocumentSegment.enabled == True,
                        )
                        .all()
                    )

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
                click.echo(
                    click.style("Error creating dataset index: {} {}".format(e.__class__.__name__, str(e)), fg="red")
                )
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
            rs = conn.execute(db.text(sql_query))

            apps = []
            for i in rs:
                app_id = str(i.id)
                if app_id not in proceeded_app_ids:
                    proceeded_app_ids.append(app_id)
                    app = db.session.query(App).filter(App.id == app_id).first()
                    if app is not None:
                        apps.append(app)

            if len(apps) == 0:
                break

        for app in apps:
            click.echo("Converting app: {}".format(app.id))

            try:
                app.mode = AppMode.AGENT_CHAT.value
                db.session.commit()

                # update conversation mode to agent
                db.session.query(Conversation).filter(Conversation.app_id == app.id).update(
                    {Conversation.mode: AppMode.AGENT_CHAT.value}
                )

                db.session.commit()
                click.echo(click.style("Converted app: {}".format(app.id), fg="green"))
            except Exception as e:
                click.echo(click.style("Convert app error: {} {}".format(e.__class__.__name__, str(e)), fg="red"))

    click.echo(click.style("Conversion complete. Converted {} agent apps.".format(len(proceeded_app_ids)), fg="green"))


@click.command("add-qdrant-doc-id-index", help="Add Qdrant doc_id index.")
@click.option("--field", default="metadata.doc_id", prompt=False, help="Index field , default is metadata.doc_id.")
def add_qdrant_doc_id_index(field: str):
    click.echo(click.style("Starting Qdrant doc_id index creation.", fg="green"))
    vector_type = dify_config.VECTOR_STORE
    if vector_type != "qdrant":
        click.echo(click.style("This command only supports Qdrant vector store.", fg="red"))
        return
    create_count = 0

    try:
        bindings = db.session.query(DatasetCollectionBinding).all()
        if not bindings:
            click.echo(click.style("No dataset collection bindings found.", fg="red"))
            return
        import qdrant_client
        from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantConfig
        from qdrant_client.http.exceptions import UnexpectedResponse
        from qdrant_client.http.models import PayloadSchemaType

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
                client = qdrant_client.QdrantClient(**qdrant_config.to_qdrant_params())
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

    except Exception as e:
        click.echo(click.style("Failed to create Qdrant client.", fg="red"))

    click.echo(click.style(f"Index creation complete. Created {create_count} collection indexes.", fg="green"))


@click.command("create-tenant", help="Create account and tenant.")
@click.option("--email", prompt=True, help="Tenant account email.")
@click.option("--name", prompt=True, help="Workspace name.")
@click.option("--language", prompt=True, help="Account language, default: en-US.")
def create_tenant(email: str, language: Optional[str] = None, name: Optional[str] = None):
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
            "Account and tenant created.\nAccount: {}\nPassword: {}".format(email, new_password),
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
            import flask_migrate  # type: ignore

            flask_migrate.upgrade()

            click.echo(click.style("Database migration successful!", fg="green"))

        except Exception as e:
            logging.exception("Failed to execute database migration")
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
            rs = conn.execute(db.text(sql))

            processed_count = 0
            for i in rs:
                processed_count += 1
                app_id = str(i.id)

                if app_id in failed_app_ids:
                    continue

                try:
                    app = db.session.query(App).filter(App.id == app_id).first()
                    if not app:
                        print(f"App {app_id} not found")
                        continue

                    tenant = app.tenant
                    if tenant:
                        accounts = tenant.get_accounts()
                        if not accounts:
                            print("Fix failed for app {}".format(app.id))
                            continue

                        account = accounts[0]
                        print("Fixing missing site for app {}".format(app.id))
                        app_was_created.send(app, account=account)
                except Exception as e:
                    failed_app_ids.append(app_id)
                    click.echo(click.style("Failed to fix missing site for app {}".format(app_id), fg="red"))
                    logging.exception(f"Failed to fix app related site missing issue, app_id: {app_id}")
                    continue

            if not processed_count:
                break

    click.echo(click.style("Fix for missing app-related sites completed successfully!", fg="green"))


@click.command("create-admin-with-phone", help="Create or update an admin account with a phone number.")
@click.option("--name", prompt=True, help="Admin account name")
@click.option("--phone", prompt=True, help="Admin account phone number")
@click.option("--tenant-id", prompt=False, help="Tenant ID (optional, uses first tenant if not provided)")
def create_admin_with_phone(name: str, phone: str, tenant_id: Optional[str] = None):
    """
    Create or update an admin account with a phone number.
    This command will create a new account if the phone doesn't exist,
    or update an existing account with the specified admin role.
    """
    try:
        # Check if account exists with this phone number
        account = db.session.query(Account).filter(Account.phone == phone).first()

        if account:
            click.echo(f"Account with phone {phone} already exists. Updating account...")

            # Update account
            account.name = name
            db.session.commit()
        else:
            click.echo(f"Creating new account with phone {phone}...")

            # Create new account with phone
            account = Account(
                name=name,
                email=f"{phone}@qingsu.chat",
                phone=phone,
                interface_language=languages[0],
                interface_theme="light",
                status="active",
            )

            db.session.add(account)
            db.session.commit()

        # Get or create tenant
        tenant_id = tenant_id or dify_config.DEFAULT_TENANT_ID
        tenant = db.session.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not tenant:
            click.echo(click.style(f"Tenant with ID {tenant_id} not found.", fg="red"))
            return

        # Check if account is already a member of the tenant
        ta_join = (
            db.session.query(TenantAccountJoin)
            .filter(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account.id)
            .first()
        )

        if ta_join:
            # Update role to end_admin
            ta_join.role = TenantAccountJoinRole.END_ADMIN.value
            click.echo(f"Updated account role to {TenantAccountJoinRole.END_ADMIN.value} in tenant {tenant.name}")
        else:
            # Add account to tenant with end_admin role
            ta_join = TenantAccountJoin(
                tenant_id=tenant.id, account_id=account.id, role=TenantAccountJoinRole.END_ADMIN.value
            )
            db.session.add(ta_join)
            click.echo(f"Added account to tenant {tenant.name} with role {TenantAccountJoinRole.END_ADMIN.value}")

        db.session.commit()

        click.echo(
            click.style(
                f"Successfully {'updated' if account else 'created'} admin account with phone number.", fg="green"
            )
        )
        click.echo(f"Name: {name}")
        click.echo(f"Phone: {phone}")
        click.echo(f"Tenant: {tenant.name} (ID: {tenant.id})")

    except Exception as e:
        db.session.rollback()
        click.echo(click.style(f"Error: {str(e)}", fg="red"))


@click.command("create-organization", help="Create a new organization for multi-school support.")
@click.option("--tenant-id", required=True, help="ID of the tenant that owns this organization")
@click.option("--name", required=True, help="Name of the organization")
@click.option("--code", required=True, help="Unique code for the organization")
@click.option(
    "--type",
    'org_type',
    default="school",
    type=click.Choice(["school", "university", "company", "organization"]),
    help="Type of organization",
)
@click.option("--description", default="", help="Description of the organization")
@click.option("--email-domains", default="", help="Comma-separated list of allowed email domains")
@click.option("--created-by", required=True, help="Account ID of the creator")
def create_organization_cmd(tenant_id, name, code, org_type, description, email_domains, created_by):
    """Create a new organization under a tenant for multi-school support"""
    try:
        # Check if code already exists
        from models.organization import Organization

        existing = db.session.query(Organization).filter(Organization.code == code).first()
        if existing:
            click.echo(f"Error: Organization with code '{code}' already exists")
            return

        # Check if creator account exists
        creator = db.session.query(Account).filter(Account.id == created_by).first()
        if not creator:
            click.echo(f"Error: Creator account with ID '{created_by}' not found")
            return

        # Parse email domains
        allowed_domains = [d.strip() for d in email_domains.split(',') if d.strip()]

        # Create settings
        settings = {'allowed_email_domains': allowed_domains}

        # Create organization
        organization = Organization(
            tenant_id=tenant_id,
            name=name,
            code=code,
            type=org_type,
            description=description,
            settings=json.dumps(settings),
            status="active",
            created_by=created_by,
        )

        db.session.add(organization)
        db.session.commit()

        click.echo(f"Organization '{name}' (ID: {organization.id}) created successfully")

    except Exception as e:
        db.session.rollback()
        click.echo(f"Error creating organization: {str(e)}")


@click.command("update-organization", help="Update an existing organization.")
@click.option("--id", 'org_id', required=True, help="ID of the organization to update")
@click.option("--name", help="New name for the organization")
@click.option("--description", help="New description")
@click.option("--email-domains", help="Comma-separated list of allowed email domains")
@click.option("--status", type=click.Choice(["active", "inactive"]), help="Organization status")
def update_organization_cmd(org_id, name, description, email_domains, status):
    """Update an existing organization's configuration"""
    try:
        from models.organization import Organization

        organization = db.session.query(Organization).filter(Organization.id == org_id).first()
        if not organization:
            click.echo(f"Error: Organization with ID '{org_id}' not found")
            return

        if name:
            organization.name = name

        if description:
            organization.description = description

        if status:
            organization.status = status

        if email_domains is not None:
            settings = organization.settings_dict
            allowed_domains = [d.strip() for d in email_domains.split(',') if d.strip()]
            settings['allowed_email_domains'] = allowed_domains
            organization.settings_dict = settings

        db.session.commit()
        click.echo(f"Organization '{organization.name}' updated successfully")

    except Exception as e:
        db.session.rollback()
        click.echo(f"Error updating organization: {str(e)}")


@click.command("list-organizations", help="List all organizations.")
@click.option("--tenant-id", help="Filter by tenant ID")
def list_organizations_cmd(tenant_id):
    """List all organizations with optional tenant filtering"""
    try:
        from models.organization import Organization

        query = db.session.query(Organization)

        if tenant_id:
            query = query.filter(Organization.tenant_id == tenant_id)

        organizations = query.all()

        if not organizations:
            click.echo("No organizations found")
            return

        click.echo(f"{'ID':<36} | {'Code':<10} | {'Name':<30} | {'Type':<12} | {'Status':<8} | {'Email Domains'}")
        click.echo("-" * 120)

        for org in organizations:
            email_domains = ', '.join(org.allowed_email_domains)
            click.echo(
                f"{org.id:<36} | {org.code:<10} | {org.name:<30} | {org.type:<12} | {org.status:<8} | {email_domains}"
            )

    except Exception as e:
        click.echo(f"Error listing organizations: {str(e)}")


@click.command("show-organization", help="Show details of a specific organization.")
@click.option("--id", 'org_id', required=True, help="ID of the organization to show")
def show_organization_cmd(org_id):
    """Show detailed information about a specific organization"""
    try:
        from models.organization import Organization

        organization = db.session.query(Organization).filter(Organization.id == org_id).first()

        if not organization:
            click.echo(f"Error: Organization with ID '{org_id}' not found")
            return

        click.echo(f"ID: {organization.id}")
        click.echo(f"Tenant ID: {organization.tenant_id}")
        click.echo(f"Name: {organization.name}")
        click.echo(f"Code: {organization.code}")
        click.echo(f"Type: {organization.type}")
        click.echo(f"Description: {organization.description or ''}")
        click.echo(f"Status: {organization.status}")
        click.echo(f"Email Domains: {', '.join(organization.allowed_email_domains)}")
        click.echo(f"Created At: {organization.created_at}")
        click.echo(f"Updated At: {organization.updated_at}")

    except Exception as e:
        click.echo(f"Error showing organization: {str(e)}")


@click.command("add-account-to-organization", help="Add an account to an organization with a specific role.")
@click.option("--org-id", required=True, help="ID of the organization")
@click.option("--account-id", required=True, help="ID of the account to add")
@click.option(
    "--role",
    required=True,
    type=click.Choice(["admin", "teacher", "student", "staff", "manager", "employee", "guest"]),
    help="Role in the organization",
)
@click.option("--department", help="Department within the organization")
@click.option("--title", help="Job title or position")
@click.option("--is-default", is_flag=True, help="Set as the account's default organization")
def add_account_to_organization_cmd(org_id, account_id, role, department, title, is_default):
    """Add an account to an organization with appropriate role and metadata"""
    try:
        from models.organization import Organization, OrganizationMember

        # Check if organization exists
        organization = db.session.query(Organization).filter(Organization.id == org_id).first()
        if not organization:
            click.echo(f"Error: Organization with ID '{org_id}' not found")
            return

        # Check if account exists
        account = db.session.query(Account).filter(Account.id == account_id).first()
        if not account:
            click.echo(f"Error: Account with ID '{account_id}' not found")
            return

        # Check if membership already exists
        existing = (
            db.session.query(OrganizationMember)
            .filter(OrganizationMember.organization_id == org_id, OrganizationMember.account_id == account_id)
            .first()
        )

        if existing:
            click.echo(f"Account is already a member of this organization. Updating role and metadata.")
            existing.role = role
            existing.department = department
            existing.title = title
            existing.is_default = is_default
        else:
            # Create new membership with meta_data instead of metadata (reserved word)
            member = OrganizationMember(
                organization_id=org_id,
                account_id=account_id,
                role=role,
                department=department,
                title=title,
                is_default=is_default,
                created_by=account_id,
                # Use meta_data instead of metadata as it's a reserved word in SQLAlchemy
                meta_data=json.dumps({}),
            )
            db.session.add(member)

        # If set as default, update the account's current_organization_id
        if is_default:
            account.current_organization_id = org_id

        db.session.commit()
        click.echo(
            f"Account successfully {'added to' if not existing else 'updated in'} organization with role '{role}'"
        )

    except Exception as e:
        db.session.rollback()
        click.echo(f"Error adding account to organization: {str(e)}")
