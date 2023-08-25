import datetime
import json
import math
import random
import string
import time

import click
from flask import current_app
from langchain.embeddings import OpenAIEmbeddings
from werkzeug.exceptions import NotFound

from core.embedding.cached_embedding import CacheEmbedding
from core.index.index import IndexBuilder
from core.model_providers.model_factory import ModelFactory
from core.model_providers.models.embedding.openai_embedding import OpenAIEmbedding
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.hosted import hosted_model_providers
from core.model_providers.providers.openai_provider import OpenAIProvider
from libs.password import password_pattern, valid_password, hash_password
from libs.helper import email as email_validate
from extensions.ext_database import db
from libs.rsa import generate_key_pair
from models.account import InvitationCode, Tenant
from models.dataset import Dataset, DatasetQuery, Document
from models.model import Account
import secrets
import base64

from models.provider import Provider, ProviderType, ProviderQuotaType, ProviderModel


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

        page += 1
        for dataset in datasets:
            try:
                click.echo('Create dataset qdrant index: {}'.format(dataset.id))
                try:
                    embedding_model = ModelFactory.get_embedding_model(
                        tenant_id=dataset.tenant_id,
                        model_provider_name=dataset.embedding_model_provider,
                        model_name=dataset.embedding_model
                    )
                except Exception:
                    provider = Provider(
                        id='provider_id',
                        tenant_id='tenant_id',
                        provider_name='openai',
                        provider_type=ProviderType.CUSTOM.value,
                        encrypted_config=json.dumps({'openai_api_key': 'TEST'}),
                        is_valid=True,
                    )
                    model_provider = OpenAIProvider(provider=provider)
                    embedding_model = OpenAIEmbedding(name="text-embedding-ada-002", model_provider=model_provider)
                embeddings = CacheEmbedding(embedding_model)

                from core.index.vector_index.qdrant_vector_index import QdrantVectorIndex, QdrantConfig

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
                    index_struct = {
                        "type": 'qdrant',
                        "vector_store": {"class_prefix": dataset.index_struct_dict['vector_store']['class_prefix']}
                    }
                    dataset.index_struct = json.dumps(index_struct)
                    db.session.commit()
                    index.create_qdrant_dataset(dataset)
                    create_count += 1
                else:
                    click.echo('passed.')
            except Exception as e:
                click.echo(
                    click.style('Create dataset index error: {} {}'.format(e.__class__.__name__, str(e)), fg='red'))
                continue

    click.echo(click.style('Congratulations! Create {} dataset indexes.'.format(create_count), fg='green'))


def register_commands(app):
    app.cli.add_command(reset_password)
    app.cli.add_command(reset_email)
    app.cli.add_command(generate_invitation_codes)
    app.cli.add_command(reset_encrypt_key_pair)
    app.cli.add_command(recreate_all_dataset_indexes)
    app.cli.add_command(sync_anthropic_hosted_providers)
    app.cli.add_command(clean_unused_dataset_indexes)
    app.cli.add_command(create_qdrant_indexes)
