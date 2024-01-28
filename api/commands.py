import base64
import datetime
import json
import math
import random
import secrets
import string
import threading
import time
import uuid

import click
import qdrant_client
from constants.languages import user_input_form_template
from core.embedding.cached_embedding import CacheEmbedding
from core.index.index import IndexBuilder
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from extensions.ext_database import db
from flask import Flask, current_app
from libs.helper import email as email_validate
from libs.password import hash_password, password_pattern, valid_password
from libs.rsa import generate_key_pair
from models.account import InvitationCode, Tenant, TenantAccountJoin
from models.dataset import Dataset, DatasetCollectionBinding, DatasetQuery, Document
from models.model import Account, App, AppModelConfig, Message, MessageAnnotation, InstalledApp
from models.provider import Provider, ProviderModel, ProviderQuotaType, ProviderType
from qdrant_client.http.models import TextIndexParams, TextIndexType, TokenizerType
from tqdm import tqdm
from werkzeug.exceptions import NotFound


@click.command('reset-password', help='Reset the account password.')
@click.option('--email', prompt=True, help='The email address of the account whose password you need to reset')
@click.option('--new-password', prompt=True, help='the new password.')
@click.option('--password-confirm', prompt=True, help='the new password confirm.')
def reset_password(email, new_password, password_confirm):
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
    click.echo(click.style('Congratulations!, password has been reset.', fg='green'))


@click.command('reset-email', help='Reset the account email.')
@click.option('--email', prompt=True, help='The old email address of the account whose email you need to reset')
@click.option('--new-email', prompt=True, help='the new email.')
@click.option('--email-confirm', prompt=True, help='the new email confirm.')
def reset_email(email, new_email, email_confirm):
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
    if current_app.config['EDITION'] != 'SELF_HOSTED':
        click.echo(click.style('Sorry, only support SELF_HOSTED mode.', fg='red'))
        return

    tenant = db.session.query(Tenant).first()
    if not tenant:
        click.echo(click.style('Sorry, no workspace found. Please enter /install to initialize.', fg='red'))
        return

    tenant.encrypt_public_key = generate_key_pair(tenant.id)

    db.session.query(Provider).filter(Provider.provider_type == 'custom').delete()
    db.session.query(ProviderModel).delete()
    db.session.commit()

    click.echo(click.style('Congratulations! '
                           'the asymmetric key pair of workspace {} has been reset.'.format(tenant.id), fg='green'))


@click.command('generate-invitation-codes', help='Generate invitation codes.')
@click.option('--batch', help='The batch of invitation codes.')
@click.option('--count', prompt=True, help='Invitation codes count.')
def generate_invitation_codes(batch, count):
    if not batch:
        now = datetime.datetime.now()
        batch = now.strftime('%Y%m%d%H%M%S')

    if not count or int(count) <= 0:
        click.echo(click.style('sorry. the count must be greater than 0.', fg='red'))
        return

    count = int(count)

    click.echo('Start generate {} invitation codes for batch {}.'.format(count, batch))

    codes = ''
    for i in range(count):
        code = generate_invitation_code()
        invitation_code = InvitationCode(
            code=code,
            batch=batch
        )
        db.session.add(invitation_code)
        click.echo(code)

        codes += code + "\n"
    db.session.commit()

    filename = 'storage/invitation-codes-{}.txt'.format(batch)

    with open(filename, 'w') as f:
        f.write(codes)

    click.echo(click.style(
        'Congratulations! Generated {} invitation codes for batch {} and saved to the file \'{}\''.format(count, batch,
                                                                                                          filename),
        fg='green'))


def generate_invitation_code():
    code = generate_upper_string()
    while db.session.query(InvitationCode).filter(InvitationCode.code == code).count() > 0:
        code = generate_upper_string()

    return code


def generate_upper_string():
    letters_digits = string.ascii_uppercase + string.digits
    result = ""
    for i in range(8):
        result += random.choice(letters_digits)

    return result


@click.command('recreate-all-dataset-indexes', help='Recreate all dataset indexes.')
def recreate_all_dataset_indexes():
    click.echo(click.style('Start recreate all dataset indexes.', fg='green'))
    recreate_count = 0

    page = 1
    while True:
        try:
            datasets = db.session.query(Dataset).filter(Dataset.indexing_technique == 'high_quality') \
                .order_by(Dataset.created_at.desc()).paginate(page=page, per_page=50)
        except NotFound:
            break

        page += 1
        for dataset in datasets:
            try:
                click.echo('Recreating dataset index: {}'.format(dataset.id))
                index = IndexBuilder.get_index(dataset, 'high_quality')
                if index and index._is_origin():
                    index.recreate_dataset(dataset)
                    recreate_count += 1
                else:
                    click.echo('passed.')
            except Exception as e:
                click.echo(
                    click.style('Recreate dataset index error: {} {}'.format(e.__class__.__name__, str(e)), fg='red'))
                continue

    click.echo(click.style('Congratulations! Recreate {} dataset indexes.'.format(recreate_count), fg='green'))


@click.command('clean-unused-dataset-indexes', help='Clean unused dataset indexes.')
def clean_unused_dataset_indexes():
    click.echo(click.style('Start clean unused dataset indexes.', fg='green'))
    clean_days = int(current_app.config.get('CLEAN_DAY_SETTING'))
    start_at = time.perf_counter()
    thirty_days_ago = datetime.datetime.now() - datetime.timedelta(days=clean_days)
    page = 1
    while True:
        try:
            datasets = db.session.query(Dataset).filter(Dataset.created_at < thirty_days_ago) \
                .order_by(Dataset.created_at.desc()).paginate(page=page, per_page=50)
        except NotFound:
            break
        page += 1
        for dataset in datasets:
            dataset_query = db.session.query(DatasetQuery).filter(
                DatasetQuery.created_at > thirty_days_ago,
                DatasetQuery.dataset_id == dataset.id
            ).all()
            if not dataset_query or len(dataset_query) == 0:
                documents = db.session.query(Document).filter(
                    Document.dataset_id == dataset.id,
                    Document.indexing_status == 'completed',
                    Document.enabled == True,
                    Document.archived == False,
                    Document.updated_at > thirty_days_ago
                ).all()
                if not documents or len(documents) == 0:
                    try:
                        # remove index
                        vector_index = IndexBuilder.get_index(dataset, 'high_quality')
                        kw_index = IndexBuilder.get_index(dataset, 'economy')
                        # delete from vector index
                        if vector_index:
                            if dataset.collection_binding_id:
                                vector_index.delete_by_group_id(dataset.id)
                            else:
                                if dataset.collection_binding_id:
                                    vector_index.delete_by_group_id(dataset.id)
                                else:
                                    vector_index.delete()
                        kw_index.delete()
                        # update document
                        update_params = {
                            Document.enabled: False
                        }

                        Document.query.filter_by(dataset_id=dataset.id).update(update_params)
                        db.session.commit()
                        click.echo(click.style('Cleaned unused dataset {} from db success!'.format(dataset.id),
                                               fg='green'))
                    except Exception as e:
                        click.echo(
                            click.style('clean dataset index error: {} {}'.format(e.__class__.__name__, str(e)),
                                        fg='red'))
    end_at = time.perf_counter()
    click.echo(click.style('Cleaned unused dataset from db success latency: {}'.format(end_at - start_at), fg='green'))


@click.command('sync-anthropic-hosted-providers', help='Sync anthropic hosted providers.')
def sync_anthropic_hosted_providers():
    if not hosted_model_providers.anthropic:
        click.echo(click.style('Anthropic hosted provider is not configured.', fg='red'))
        return

    click.echo(click.style('Start sync anthropic hosted providers.', fg='green'))
    count = 0

    new_quota_limit = hosted_model_providers.anthropic.quota_limit

    page = 1
    while True:
        try:
            providers = db.session.query(Provider).filter(
                Provider.provider_name == 'anthropic',
                Provider.provider_type == ProviderType.SYSTEM.value,
                Provider.quota_type == ProviderQuotaType.TRIAL.value,
                Provider.quota_limit != new_quota_limit
            ).order_by(Provider.created_at.desc()).paginate(page=page, per_page=100)
        except NotFound:
            break

        page += 1
        for provider in providers:
            try:
                click.echo('Syncing tenant anthropic hosted provider: {}, origin: limit {}, used {}'
                           .format(provider.tenant_id, provider.quota_limit, provider.quota_used))
                original_quota_limit = provider.quota_limit
                division = math.ceil(new_quota_limit / 1000)

                provider.quota_limit = new_quota_limit if original_quota_limit == 1000 \
                    else original_quota_limit * division
                provider.quota_used = division * provider.quota_used
                db.session.commit()

                count += 1
            except Exception as e:
                click.echo(click.style(
                    'Sync tenant anthropic hosted provider error: {} {}'.format(e.__class__.__name__, str(e)),
                    fg='red'))
                continue

    click.echo(click.style('Congratulations! Synced {} anthropic hosted providers.'.format(count), fg='green'))


@click.command('create-qdrant-indexes', help='Create qdrant indexes.')
def create_qdrant_indexes():
    click.echo(click.style('Start create qdrant indexes.', fg='green'))
    create_count = 0

    page = 1
    while True:
        try:
            datasets = db.session.query(Dataset).filter(Dataset.indexing_technique == 'high_quality') \
                .order_by(Dataset.created_at.desc()).paginate(page=page, per_page=50)
        except NotFound:
            break

        model_manager = ModelManager()

        page += 1
        for dataset in datasets:
            if dataset.index_struct_dict:
                if dataset.index_struct_dict['type'] != 'qdrant':
                    try:
                        click.echo('Create dataset qdrant index: {}'.format(dataset.id))
                        try:
                            embedding_model = model_manager.get_model_instance(
                                tenant_id=dataset.tenant_id,
                                provider=dataset.embedding_model_provider,
                                model_type=ModelType.TEXT_EMBEDDING,
                                model=dataset.embedding_model

                            )
                        except Exception:
                            continue
                        embeddings = CacheEmbedding(embedding_model)

                        from core.index.vector_index.qdrant_vector_index import QdrantConfig, QdrantVectorIndex

                        index = QdrantVectorIndex(
                            dataset=dataset,
                            config=QdrantConfig(
                                endpoint=current_app.config.get('QDRANT_URL'),
                                api_key=current_app.config.get('QDRANT_API_KEY'),
                                root_path=current_app.root_path
                            ),
                            embeddings=embeddings
                        )
                        if index:
                            index.create_qdrant_dataset(dataset)
                            index_struct = {
                                "type": 'qdrant',
                                "vector_store": {
                                    "class_prefix": dataset.index_struct_dict['vector_store']['class_prefix']}
                            }
                            dataset.index_struct = json.dumps(index_struct)
                            db.session.commit()
                            create_count += 1
                        else:
                            click.echo('passed.')
                    except Exception as e:
                        click.echo(
                            click.style('Create dataset index error: {} {}'.format(e.__class__.__name__, str(e)),
                                        fg='red'))
                        continue

    click.echo(click.style('Congratulations! Create {} dataset indexes.'.format(create_count), fg='green'))


@click.command('update-qdrant-indexes', help='Update qdrant indexes.')
def update_qdrant_indexes():
    click.echo(click.style('Start Update qdrant indexes.', fg='green'))
    create_count = 0

    page = 1
    while True:
        try:
            datasets = db.session.query(Dataset).filter(Dataset.indexing_technique == 'high_quality') \
                .order_by(Dataset.created_at.desc()).paginate(page=page, per_page=50)
        except NotFound:
            break
        model_manager = ModelManager()
        page += 1
        for dataset in datasets:
            if dataset.index_struct_dict:
                if dataset.index_struct_dict['type'] != 'qdrant':
                    try:
                        click.echo('Update dataset qdrant index: {}'.format(dataset.id))
                        try:
                            embedding_model = model_manager.get_model_instance(
                                tenant_id=dataset.tenant_id,
                                provider=dataset.embedding_model_provider,
                                model_type=ModelType.TEXT_EMBEDDING,
                                model=dataset.embedding_model

                            )
                        except Exception:
                            continue
                        embeddings = CacheEmbedding(embedding_model)

                        from core.index.vector_index.qdrant_vector_index import QdrantConfig, QdrantVectorIndex

                        index = QdrantVectorIndex(
                            dataset=dataset,
                            config=QdrantConfig(
                                endpoint=current_app.config.get('QDRANT_URL'),
                                api_key=current_app.config.get('QDRANT_API_KEY'),
                                root_path=current_app.root_path
                            ),
                            embeddings=embeddings
                        )
                        if index:
                            index.update_qdrant_dataset(dataset)
                            create_count += 1
                        else:
                            click.echo('passed.')
                    except Exception as e:
                        click.echo(
                            click.style('Create dataset index error: {} {}'.format(e.__class__.__name__, str(e)),
                                        fg='red'))
                        continue

    click.echo(click.style('Congratulations! Update {} dataset indexes.'.format(create_count), fg='green'))


@click.command('normalization-collections', help='restore all collections in one')
def normalization_collections():
    click.echo(click.style('Start normalization collections.', fg='green'))
    normalization_count = []
    page = 1
    while True:
        try:
            datasets = db.session.query(Dataset).filter(Dataset.indexing_technique == 'high_quality') \
                .order_by(Dataset.created_at.desc()).paginate(page=page, per_page=100)
        except NotFound:
            break
        datasets_result = datasets.items
        page += 1
        for i in range(0, len(datasets_result), 5):
            threads = []
            sub_datasets = datasets_result[i:i + 5]
            for dataset in sub_datasets:
                document_format_thread = threading.Thread(target=deal_dataset_vector, kwargs={
                    'flask_app': current_app._get_current_object(),
                    'dataset': dataset,
                    'normalization_count': normalization_count
                })
                threads.append(document_format_thread)
                document_format_thread.start()
            for thread in threads:
                thread.join()

    click.echo(click.style('Congratulations! restore {} dataset indexes.'.format(len(normalization_count)), fg='green'))


@click.command('add-qdrant-full-text-index', help='add qdrant full text index')
def add_qdrant_full_text_index():
    click.echo(click.style('Start add full text index.', fg='green'))
    binds = db.session.query(DatasetCollectionBinding).all()
    if binds and current_app.config['VECTOR_STORE'] == 'qdrant':
        qdrant_url = current_app.config['QDRANT_URL']
        qdrant_api_key = current_app.config['QDRANT_API_KEY']
        client = qdrant_client.QdrantClient(
            qdrant_url,
            api_key=qdrant_api_key,  # For Qdrant Cloud, None for local instance
        )
        for bind in binds:
            try:
                text_index_params = TextIndexParams(
                    type=TextIndexType.TEXT,
                    tokenizer=TokenizerType.MULTILINGUAL,
                    min_token_len=2,
                    max_token_len=20,
                    lowercase=True
                )
                client.create_payload_index(bind.collection_name, 'page_content',
                                            field_schema=text_index_params)
            except Exception as e:
                click.echo(
                    click.style('Create full text index error: {} {}'.format(e.__class__.__name__, str(e)),
                                fg='red'))
            click.echo(
                click.style(
                    'Congratulations! add collection {} full text index successful.'.format(bind.collection_name),
                    fg='green'))


def deal_dataset_vector(flask_app: Flask, dataset: Dataset, normalization_count: list):
    with flask_app.app_context():
        try:
            click.echo('restore dataset index: {}'.format(dataset.id))
            try:
                model_manager = ModelManager()

                embedding_model = model_manager.get_model_instance(
                    tenant_id=dataset.tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model

                )
            except Exception:
                pass
            embeddings = CacheEmbedding(embedding_model)
            dataset_collection_binding = db.session.query(DatasetCollectionBinding). \
                filter(DatasetCollectionBinding.provider_name == embedding_model.model_provider.provider_name,
                       DatasetCollectionBinding.model_name == embedding_model.name). \
                order_by(DatasetCollectionBinding.created_at). \
                first()

            if not dataset_collection_binding:
                dataset_collection_binding = DatasetCollectionBinding(
                    provider_name=embedding_model.model_provider.provider_name,
                    model_name=embedding_model.name,
                    collection_name="Vector_index_" + str(uuid.uuid4()).replace("-", "_") + '_Node'
                )
                db.session.add(dataset_collection_binding)
                db.session.commit()

            from core.index.vector_index.qdrant_vector_index import QdrantConfig, QdrantVectorIndex

            index = QdrantVectorIndex(
                dataset=dataset,
                config=QdrantConfig(
                    endpoint=current_app.config.get('QDRANT_URL'),
                    api_key=current_app.config.get('QDRANT_API_KEY'),
                    root_path=current_app.root_path
                ),
                embeddings=embeddings
            )
            if index:
                # index.delete_by_group_id(dataset.id)
                index.restore_dataset_in_one(dataset, dataset_collection_binding)
            else:
                click.echo('passed.')
            normalization_count.append(1)
        except Exception as e:
            click.echo(
                click.style('Create dataset index error: {} {}'.format(e.__class__.__name__, str(e)),
                            fg='red'))


@click.command('update_app_model_configs', help='Migrate data to support paragraph variable.')
@click.option("--batch-size", default=500, help="Number of records to migrate in each batch.")
def update_app_model_configs(batch_size):
    pre_prompt_template = '{{default_input}}'

    click.secho("Start migrate old data that the text generator can support paragraph variable.", fg='green')

    total_records = db.session.query(AppModelConfig) \
        .join(App, App.app_model_config_id == AppModelConfig.id) \
        .filter(App.mode == 'completion') \
        .count()

    if total_records == 0:
        click.secho("No data to migrate.", fg='green')
        return

    num_batches = (total_records + batch_size - 1) // batch_size

    with tqdm(total=total_records, desc="Migrating Data") as pbar:
        for i in range(num_batches):
            offset = i * batch_size
            limit = min(batch_size, total_records - offset)

            click.secho(f"Fetching batch {i + 1}/{num_batches} from source database...", fg='green')

            data_batch = db.session.query(AppModelConfig) \
                .join(App, App.app_model_config_id == AppModelConfig.id) \
                .filter(App.mode == 'completion') \
                .order_by(App.created_at) \
                .offset(offset).limit(limit).all()

            if not data_batch:
                click.secho("No more data to migrate.", fg='green')
                break

            try:
                click.secho(f"Migrating {len(data_batch)} records...", fg='green')
                for data in data_batch:
                    # click.secho(f"Migrating data {data.id}, pre_prompt: {data.pre_prompt}, user_input_form: {data.user_input_form}", fg='green')

                    if data.pre_prompt is None:
                        data.pre_prompt = pre_prompt_template
                    else:
                        if pre_prompt_template in data.pre_prompt:
                            continue
                        data.pre_prompt += pre_prompt_template

                    app_data = db.session.query(App) \
                        .filter(App.id == data.app_id) \
                        .one()

                    account_data = db.session.query(Account) \
                        .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id) \
                        .filter(TenantAccountJoin.role == 'owner') \
                        .filter(TenantAccountJoin.tenant_id == app_data.tenant_id) \
                        .one_or_none()

                    if not account_data:
                        continue

                    if data.user_input_form is None or data.user_input_form == 'null':
                        data.user_input_form = json.dumps(user_input_form_template[account_data.interface_language])
                    else:
                        raw_json_data = json.loads(data.user_input_form)
                        raw_json_data.append(user_input_form_template[account_data.interface_language][0])
                        data.user_input_form = json.dumps(raw_json_data)

                    # click.secho(f"Updated data {data.id}, pre_prompt: {data.pre_prompt}, user_input_form: {data.user_input_form}", fg='green')

                db.session.commit()

            except Exception as e:
                click.secho(f"Error while migrating data: {e}, app_id: {data.app_id}, app_model_config_id: {data.id}",
                            fg='red')
                continue

            click.secho(f"Successfully migrated batch {i + 1}/{num_batches}.", fg='green')

            pbar.update(len(data_batch))


@click.command('migrate_default_input_to_dataset_query_variable')
@click.option("--batch-size", default=500, help="Number of records to migrate in each batch.")
def migrate_default_input_to_dataset_query_variable(batch_size):
    click.secho("Starting...", fg='green')

    total_records = db.session.query(AppModelConfig) \
        .join(App, App.app_model_config_id == AppModelConfig.id) \
        .filter(App.mode == 'completion') \
        .filter(AppModelConfig.dataset_query_variable == None) \
        .count()

    if total_records == 0:
        click.secho("No data to migrate.", fg='green')
        return

    num_batches = (total_records + batch_size - 1) // batch_size

    with tqdm(total=total_records, desc="Migrating Data") as pbar:
        for i in range(num_batches):
            offset = i * batch_size
            limit = min(batch_size, total_records - offset)

            click.secho(f"Fetching batch {i + 1}/{num_batches} from source database...", fg='green')

            data_batch = db.session.query(AppModelConfig) \
                .join(App, App.app_model_config_id == AppModelConfig.id) \
                .filter(App.mode == 'completion') \
                .filter(AppModelConfig.dataset_query_variable == None) \
                .order_by(App.created_at) \
                .offset(offset).limit(limit).all()

            if not data_batch:
                click.secho("No more data to migrate.", fg='green')
                break

            try:
                click.secho(f"Migrating {len(data_batch)} records...", fg='green')
                for data in data_batch:
                    config = AppModelConfig.to_dict(data)

                    tools = config["agent_mode"]["tools"]
                    dataset_exists = "dataset" in str(tools)
                    if not dataset_exists:
                        continue

                    user_input_form = config.get("user_input_form", [])
                    for form in user_input_form:
                        paragraph = form.get('paragraph')
                        if paragraph \
                                and paragraph.get('variable') == 'query':
                            data.dataset_query_variable = 'query'
                            break

                        if paragraph \
                                and paragraph.get('variable') == 'default_input':
                            data.dataset_query_variable = 'default_input'
                            break

                db.session.commit()

            except Exception as e:
                click.secho(f"Error while migrating data: {e}, app_id: {data.app_id}, app_model_config_id: {data.id}",
                            fg='red')
                continue

            click.secho(f"Successfully migrated batch {i + 1}/{num_batches}.", fg='green')

            pbar.update(len(data_batch))


@click.command('add-annotation-question-field-value', help='add annotation question value')
def add_annotation_question_field_value():
    click.echo(click.style('Start add annotation question value.', fg='green'))
    message_annotations = db.session.query(MessageAnnotation).all()
    message_annotation_deal_count = 0
    if message_annotations:
        for message_annotation in message_annotations:
            try:
                if message_annotation.message_id and not message_annotation.question:
                    message = db.session.query(Message).filter(
                        Message.id == message_annotation.message_id
                    ).first()
                    message_annotation.question = message.query
                    db.session.add(message_annotation)
                    db.session.commit()
                    message_annotation_deal_count += 1
            except Exception as e:
                click.echo(
                    click.style('Add annotation question value error: {} {}'.format(e.__class__.__name__, str(e)),
                                fg='red'))
            click.echo(
                click.style(f'Congratulations! add annotation question value successful. Deal count {message_annotation_deal_count}', fg='green'))


def register_commands(app):
    app.cli.add_command(reset_password)
    app.cli.add_command(reset_email)
    app.cli.add_command(generate_invitation_codes)
    app.cli.add_command(reset_encrypt_key_pair)
    app.cli.add_command(recreate_all_dataset_indexes)
    app.cli.add_command(sync_anthropic_hosted_providers)
    app.cli.add_command(clean_unused_dataset_indexes)
    app.cli.add_command(create_qdrant_indexes)
    app.cli.add_command(update_qdrant_indexes)
    app.cli.add_command(update_app_model_configs)
    app.cli.add_command(normalization_collections)
    app.cli.add_command(migrate_default_input_to_dataset_query_variable)
    app.cli.add_command(add_qdrant_full_text_index)
    app.cli.add_command(add_annotation_question_field_value)
