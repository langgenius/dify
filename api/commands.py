import base64
import json
import logging
import secrets
from typing import Optional

import click
from flask import current_app
from werkzeug.exceptions import NotFound

from constants.languages import languages
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.helper import email as email_validate
from libs.password import hash_password, password_pattern, valid_password
from libs.rsa import generate_key_pair
from models.account import Tenant
from models.dataset import Dataset, DatasetCollectionBinding, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.model import Account, App, AppAnnotationSetting, AppMode, Conversation, MessageAnnotation
from models.provider import Provider, ProviderModel
from services.account_service import RegisterService, TenantService


@click.command('reset-password', help='Reset the account password.')
@click.option('--email', prompt=True, help='The email address of the account whose password you need to reset')
@click.option('--new-password', prompt=True, help='the new password.')
@click.option('--password-confirm', prompt=True, help='the new password confirm.')
def reset_password(email, new_password, password_confirm):
    """
    Reset password of owner account
    Only available in SELF_HOSTED mode
    """
    if str(new_password).strip() != str(password_confirm).strip():
        click.echo(click.style('sorry. The two passwords do not match.', fg='red'))
        return

    account = db.session.query(Account). \
        filter(Account.email == email). \
        one_or_none()

    if not account:
        click.echo(click.style('sorry. the account: [{}] not exist .'.format(email), fg='red'))
        return

    try:
        valid_password(new_password)
    except:
        click.echo(
            click.style('sorry. The passwords must match {} '.format(password_pattern), fg='red'))
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
    click.echo(click.style('Congratulations! Password has been reset.', fg='green'))


@click.command('reset-email', help='Reset the account email.')
@click.option('--email', prompt=True, help='The old email address of the account whose email you need to reset')
@click.option('--new-email', prompt=True, help='the new email.')
@click.option('--email-confirm', prompt=True, help='the new email confirm.')
def reset_email(email, new_email, email_confirm):
    """
    Replace account email
    :return:
    """
    if str(new_email).strip() != str(email_confirm).strip():
        click.echo(click.style('Sorry, new email and confirm email do not match.', fg='red'))
        return

    account = db.session.query(Account). \
        filter(Account.email == email). \
        one_or_none()

    if not account:
        click.echo(click.style('sorry. the account: [{}] not exist .'.format(email), fg='red'))
        return

    try:
        email_validate(new_email)
    except:
        click.echo(
            click.style('sorry. {} is not a valid email. '.format(email), fg='red'))
        return

    account.email = new_email
    db.session.commit()
    click.echo(click.style('Congratulations!, email has been reset.', fg='green'))


@click.command('reset-encrypt-key-pair', help='Reset the asymmetric key pair of workspace for encrypt LLM credentials. '
                                              'After the reset, all LLM credentials will become invalid, '
                                              'requiring re-entry.'
                                              'Only support SELF_HOSTED mode.')
@click.confirmation_option(prompt=click.style('Are you sure you want to reset encrypt key pair?'
                                              ' this operation cannot be rolled back!', fg='red'))
def reset_encrypt_key_pair():
    """
    Reset the encrypted key pair of workspace for encrypt LLM credentials.
    After the reset, all LLM credentials will become invalid, requiring re-entry.
    Only support SELF_HOSTED mode.
    """
    if current_app.config['EDITION'] != 'SELF_HOSTED':
        click.echo(click.style('Sorry, only support SELF_HOSTED mode.', fg='red'))
        return

    tenants = db.session.query(Tenant).all()
    for tenant in tenants:
        if not tenant:
            click.echo(click.style('Sorry, no workspace found. Please enter /install to initialize.', fg='red'))
            return

        tenant.encrypt_public_key = generate_key_pair(tenant.id)

        db.session.query(Provider).filter(Provider.provider_type == 'custom', Provider.tenant_id == tenant.id).delete()
        db.session.query(ProviderModel).filter(ProviderModel.tenant_id == tenant.id).delete()
        db.session.commit()

        click.echo(click.style('Congratulations! '
                               'the asymmetric key pair of workspace {} has been reset.'.format(tenant.id), fg='green'))


@click.command('vdb-migrate', help='migrate vector db.')
@click.option('--scope', default='all', prompt=False, help='The scope of vector database to migrate, Default is All.')
def vdb_migrate(scope: str):
    if scope in ['knowledge', 'all']:
        migrate_knowledge_vector_database()
    if scope in ['annotation', 'all']:
        migrate_annotation_vector_database()


def migrate_annotation_vector_database():
    """
    Migrate annotation datas to target vector database .
    """
    click.echo(click.style('Start migrate annotation data.', fg='green'))
    create_count = 0
    skipped_count = 0
    total_count = 0
    page = 1
    while True:
        try:
            # get apps info
            apps = db.session.query(App).filter(
                App.status == 'normal'
            ).order_by(App.created_at.desc()).paginate(page=page, per_page=50)
        except NotFound:
            break

        page += 1
        for app in apps:
            total_count = total_count + 1
            click.echo(f'Processing the {total_count} app {app.id}. '
                       + f'{create_count} created, {skipped_count} skipped.')
            try:
                click.echo('Create app annotation index: {}'.format(app.id))
                app_annotation_setting = db.session.query(AppAnnotationSetting).filter(
                    AppAnnotationSetting.app_id == app.id
                ).first()

                if not app_annotation_setting:
                    skipped_count = skipped_count + 1
                    click.echo('App annotation setting is disabled: {}'.format(app.id))
                    continue
                # get dataset_collection_binding info
                dataset_collection_binding = db.session.query(DatasetCollectionBinding).filter(
                    DatasetCollectionBinding.id == app_annotation_setting.collection_binding_id
                ).first()
                if not dataset_collection_binding:
                    click.echo('App annotation collection binding is not exist: {}'.format(app.id))
                    continue
                annotations = db.session.query(MessageAnnotation).filter(MessageAnnotation.app_id == app.id).all()
                dataset = Dataset(
                    id=app.id,
                    tenant_id=app.tenant_id,
                    indexing_technique='high_quality',
                    embedding_model_provider=dataset_collection_binding.provider_name,
                    embedding_model=dataset_collection_binding.model_name,
                    collection_binding_id=dataset_collection_binding.id
                )
                documents = []
                if annotations:
                    for annotation in annotations:
                        document = Document(
                            page_content=annotation.question,
                            metadata={
                                "annotation_id": annotation.id,
                                "app_id": app.id,
                                "doc_id": annotation.id
                            }
                        )
                        documents.append(document)

                vector = Vector(dataset, attributes=['doc_id', 'annotation_id', 'app_id'])
                click.echo(f"Start to migrate annotation, app_id: {app.id}.")

                try:
                    vector.delete()
                    click.echo(
                        click.style(f'Successfully delete vector index for app: {app.id}.',
                                    fg='green'))
                except Exception as e:
                    click.echo(
                        click.style(f'Failed to delete vector index for app {app.id}.',
                                    fg='red'))
                    raise e
                if documents:
                    try:
                        click.echo(click.style(
                            f'Start to created vector index with {len(documents)} annotations for app {app.id}.',
                            fg='green'))
                        vector.create(documents)
                        click.echo(
                            click.style(f'Successfully created vector index for app {app.id}.', fg='green'))
                    except Exception as e:
                        click.echo(click.style(f'Failed to created vector index for app {app.id}.', fg='red'))
                        raise e
                click.echo(f'Successfully migrated app annotation {app.id}.')
                create_count += 1
            except Exception as e:
                click.echo(
                    click.style('Create app annotation index error: {} {}'.format(e.__class__.__name__, str(e)),
                                fg='red'))
                continue

    click.echo(
        click.style(f'Congratulations! Create {create_count} app annotation indexes, and skipped {skipped_count} apps.',
                    fg='green'))


def migrate_knowledge_vector_database():
    """
    Migrate vector database datas to target vector database .
    """
    click.echo(click.style('Start migrate vector db.', fg='green'))
    create_count = 0
    skipped_count = 0
    total_count = 0
    config = current_app.config
    vector_type = config.get('VECTOR_STORE')
    page = 1
    while True:
        try:
            datasets = db.session.query(Dataset).filter(Dataset.indexing_technique == 'high_quality') \
                .order_by(Dataset.created_at.desc()).paginate(page=page, per_page=50)
        except NotFound:
            break

        page += 1
        for dataset in datasets:
            total_count = total_count + 1
            click.echo(f'Processing the {total_count} dataset {dataset.id}. '
                       + f'{create_count} created, {skipped_count} skipped.')
            try:
                click.echo('Create dataset vdb index: {}'.format(dataset.id))
                if dataset.index_struct_dict:
                    if dataset.index_struct_dict['type'] == vector_type:
                        skipped_count = skipped_count + 1
                        continue
                collection_name = ''
                if vector_type == VectorType.WEAVIATE:
                    dataset_id = dataset.id
                    collection_name = Dataset.gen_collection_name_by_id(dataset_id)
                    index_struct_dict = {
                        "type": VectorType.WEAVIATE,
                        "vector_store": {"class_prefix": collection_name}
                    }
                    dataset.index_struct = json.dumps(index_struct_dict)
                elif vector_type == VectorType.QDRANT:
                    if dataset.collection_binding_id:
                        dataset_collection_binding = db.session.query(DatasetCollectionBinding). \
                            filter(DatasetCollectionBinding.id == dataset.collection_binding_id). \
                            one_or_none()
                        if dataset_collection_binding:
                            collection_name = dataset_collection_binding.collection_name
                        else:
                            raise ValueError('Dataset Collection Bindings is not exist!')
                    else:
                        dataset_id = dataset.id
                        collection_name = Dataset.gen_collection_name_by_id(dataset_id)
                    index_struct_dict = {
                        "type": VectorType.QDRANT,
                        "vector_store": {"class_prefix": collection_name}
                    }
                    dataset.index_struct = json.dumps(index_struct_dict)

                elif vector_type == VectorType.MILVUS:
                    dataset_id = dataset.id
                    collection_name = Dataset.gen_collection_name_by_id(dataset_id)
                    index_struct_dict = {
                        "type": VectorType.MILVUS,
                        "vector_store": {"class_prefix": collection_name}
                    }
                    dataset.index_struct = json.dumps(index_struct_dict)
                elif vector_type == VectorType.RELYT:
                    dataset_id = dataset.id
                    collection_name = Dataset.gen_collection_name_by_id(dataset_id)
                    index_struct_dict = {
                        "type": 'relyt',
                        "vector_store": {"class_prefix": collection_name}
                    }
                    dataset.index_struct = json.dumps(index_struct_dict)
                elif vector_type == VectorType.TENCENT:
                    dataset_id = dataset.id
                    collection_name = Dataset.gen_collection_name_by_id(dataset_id)
                    index_struct_dict = {
                        "type": VectorType.TENCENT,
                        "vector_store": {"class_prefix": collection_name}
                    }
                    dataset.index_struct = json.dumps(index_struct_dict)
                elif vector_type == VectorType.PGVECTOR:
                    dataset_id = dataset.id
                    collection_name = Dataset.gen_collection_name_by_id(dataset_id)
                    index_struct_dict = {
                        "type": VectorType.PGVECTOR,
                        "vector_store": {"class_prefix": collection_name}
                    }
                    dataset.index_struct = json.dumps(index_struct_dict)
                elif vector_type == VectorType.OPENSEARCH:
                    dataset_id = dataset.id
                    collection_name = Dataset.gen_collection_name_by_id(dataset_id)
                    index_struct_dict = {
                        "type": VectorType.OPENSEARCH,
                        "vector_store": {"class_prefix": collection_name}
                    }
                    dataset.index_struct = json.dumps(index_struct_dict)
                else:
                    raise ValueError(f"Vector store {vector_type} is not supported.")

                vector = Vector(dataset)
                click.echo(f"Start to migrate dataset {dataset.id}.")

                try:
                    vector.delete()
                    click.echo(
                        click.style(f'Successfully delete vector index {collection_name} for dataset {dataset.id}.',
                                    fg='green'))
                except Exception as e:
                    click.echo(
                        click.style(f'Failed to delete vector index {collection_name} for dataset {dataset.id}.',
                                    fg='red'))
                    raise e

                dataset_documents = db.session.query(DatasetDocument).filter(
                    DatasetDocument.dataset_id == dataset.id,
                    DatasetDocument.indexing_status == 'completed',
                    DatasetDocument.enabled == True,
                    DatasetDocument.archived == False,
                ).all()

                documents = []
                segments_count = 0
                for dataset_document in dataset_documents:
                    segments = db.session.query(DocumentSegment).filter(
                        DocumentSegment.document_id == dataset_document.id,
                        DocumentSegment.status == 'completed',
                        DocumentSegment.enabled == True
                    ).all()

                    for segment in segments:
                        document = Document(
                            page_content=segment.content,
                            metadata={
                                "doc_id": segment.index_node_id,
                                "doc_hash": segment.index_node_hash,
                                "document_id": segment.document_id,
                                "dataset_id": segment.dataset_id,
                            }
                        )

                        documents.append(document)
                        segments_count = segments_count + 1

                if documents:
                    try:
                        click.echo(click.style(
                            f'Start to created vector index with {len(documents)} documents of {segments_count} segments for dataset {dataset.id}.',
                            fg='green'))
                        vector.create(documents)
                        click.echo(
                            click.style(f'Successfully created vector index for dataset {dataset.id}.', fg='green'))
                    except Exception as e:
                        click.echo(click.style(f'Failed to created vector index for dataset {dataset.id}.', fg='red'))
                        raise e
                db.session.add(dataset)
                db.session.commit()
                click.echo(f'Successfully migrated dataset {dataset.id}.')
                create_count += 1
            except Exception as e:
                db.session.rollback()
                click.echo(
                    click.style('Create dataset index error: {} {}'.format(e.__class__.__name__, str(e)),
                                fg='red'))
                continue

    click.echo(
        click.style(f'Congratulations! Create {create_count} dataset indexes, and skipped {skipped_count} datasets.',
                    fg='green'))


@click.command('convert-to-agent-apps', help='Convert Agent Assistant to Agent App.')
def convert_to_agent_apps():
    """
    Convert Agent Assistant to Agent App.
    """
    click.echo(click.style('Start convert to agent apps.', fg='green'))

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
                    apps.append(app)

            if len(apps) == 0:
                break

        for app in apps:
            click.echo('Converting app: {}'.format(app.id))

            try:
                app.mode = AppMode.AGENT_CHAT.value
                db.session.commit()

                # update conversation mode to agent
                db.session.query(Conversation).filter(Conversation.app_id == app.id).update(
                    {Conversation.mode: AppMode.AGENT_CHAT.value}
                )

                db.session.commit()
                click.echo(click.style('Converted app: {}'.format(app.id), fg='green'))
            except Exception as e:
                click.echo(
                    click.style('Convert app error: {} {}'.format(e.__class__.__name__,
                                                                  str(e)), fg='red'))

    click.echo(click.style('Congratulations! Converted {} agent apps.'.format(len(proceeded_app_ids)), fg='green'))


@click.command('add-qdrant-doc-id-index', help='add qdrant doc_id index.')
@click.option('--field', default='metadata.doc_id', prompt=False, help='index field , default is metadata.doc_id.')
def add_qdrant_doc_id_index(field: str):
    click.echo(click.style('Start add qdrant doc_id index.', fg='green'))
    config = current_app.config
    vector_type = config.get('VECTOR_STORE')
    if vector_type != "qdrant":
        click.echo(click.style('Sorry, only support qdrant vector store.', fg='red'))
        return
    create_count = 0

    try:
        bindings = db.session.query(DatasetCollectionBinding).all()
        if not bindings:
            click.echo(click.style('Sorry, no dataset collection bindings found.', fg='red'))
            return
        import qdrant_client
        from qdrant_client.http.exceptions import UnexpectedResponse
        from qdrant_client.http.models import PayloadSchemaType

        from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantConfig
        for binding in bindings:
            qdrant_config = QdrantConfig(
                endpoint=config.get('QDRANT_URL'),
                api_key=config.get('QDRANT_API_KEY'),
                root_path=current_app.root_path,
                timeout=config.get('QDRANT_CLIENT_TIMEOUT'),
                grpc_port=config.get('QDRANT_GRPC_PORT'),
                prefer_grpc=config.get('QDRANT_GRPC_ENABLED')
            )
            try:
                client = qdrant_client.QdrantClient(**qdrant_config.to_qdrant_params())
                # create payload index
                client.create_payload_index(binding.collection_name, field,
                                            field_schema=PayloadSchemaType.KEYWORD)
                create_count += 1
            except UnexpectedResponse as e:
                # Collection does not exist, so return
                if e.status_code == 404:
                    click.echo(click.style(f'Collection not found, collection_name:{binding.collection_name}.', fg='red'))
                    continue
                # Some other error occurred, so re-raise the exception
                else:
                    click.echo(click.style(f'Failed to create qdrant index, collection_name:{binding.collection_name}.', fg='red'))

    except Exception as e:
        click.echo(click.style('Failed to create qdrant client.', fg='red'))

    click.echo(
        click.style(f'Congratulations! Create {create_count} collection indexes.',
                    fg='green'))


@click.command('create-tenant', help='Create account and tenant.')
@click.option('--email', prompt=True, help='The email address of the tenant account.')
@click.option('--language', prompt=True, help='Account language, default: en-US.')
def create_tenant(email: str, language: Optional[str] = None):
    """
    Create tenant account
    """
    if not email:
        click.echo(click.style('Sorry, email is required.', fg='red'))
        return

    # Create account
    email = email.strip()

    if '@' not in email:
        click.echo(click.style('Sorry, invalid email address.', fg='red'))
        return

    account_name = email.split('@')[0]

    if language not in languages:
        language = 'en-US'

    # generate random password
    new_password = secrets.token_urlsafe(16)

    # register account
    account = RegisterService.register(
        email=email,
        name=account_name,
        password=new_password,
        language=language
    )

    TenantService.create_owner_tenant_if_not_exist(account)

    click.echo(click.style('Congratulations! Account and tenant created.\n'
                           'Account: {}\nPassword: {}'.format(email, new_password), fg='green'))


@click.command('upgrade-db', help='upgrade the database')
def upgrade_db():
    click.echo('Preparing database migration...')
    lock = redis_client.lock(name='db_upgrade_lock', timeout=60)
    if lock.acquire(blocking=False):
        try:
            click.echo(click.style('Start database migration.', fg='green'))

            # run db migration
            import flask_migrate
            flask_migrate.upgrade()

            click.echo(click.style('Database migration successful!', fg='green'))

        except Exception as e:
            logging.exception(f'Database migration failed, error: {e}')
        finally:
            lock.release()
    else:
        click.echo('Database migration skipped')


def register_commands(app):
    app.cli.add_command(reset_password)
    app.cli.add_command(reset_email)
    app.cli.add_command(reset_encrypt_key_pair)
    app.cli.add_command(vdb_migrate)
    app.cli.add_command(convert_to_agent_apps)
    app.cli.add_command(add_qdrant_doc_id_index)
    app.cli.add_command(create_tenant)
    app.cli.add_command(upgrade_db)
