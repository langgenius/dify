import base64
import json
import secrets

import click
from core.embedding.cached_embedding import CacheEmbedding
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from extensions.ext_database import db
from flask import current_app
from libs.helper import email as email_validate
from libs.password import hash_password, password_pattern, valid_password
from libs.rsa import generate_key_pair
from models.account import Tenant
from models.dataset import Dataset
from models.model import Account
from models.provider import Provider, ProviderModel
from werkzeug.exceptions import NotFound


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
    click.echo(click.style('Congratulations!, password has been reset.', fg='green'))


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


@click.command('create-qdrant-indexes', help='Create qdrant indexes.')
def create_qdrant_indexes():
    """
    Migrate other vector database datas to Qdrant.
    """
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


def register_commands(app):
    app.cli.add_command(reset_password)
    app.cli.add_command(reset_email)
    app.cli.add_command(reset_encrypt_key_pair)
    app.cli.add_command(create_qdrant_indexes)
