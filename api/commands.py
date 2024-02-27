import base64
import json
import secrets

import click
from flask import current_app
from werkzeug.exceptions import NotFound

from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.models.document import Document
from extensions.ext_database import db
from libs.helper import email as email_validate
from libs.password import hash_password, password_pattern, valid_password
from libs.rsa import generate_key_pair
from models.account import Tenant
from models.dataset import Dataset, DatasetCollectionBinding, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.model import Account
from models.provider import Provider, ProviderModel


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


@click.command('vdb-migrate', help='migrate vector db.')
def vdb_migrate():
    """
    Migrate vector database datas to target vector database .
    """
    click.echo(click.style('Start migrate vector db.', fg='green'))
    create_count = 0
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
            try:
                click.echo('Create dataset vdb index: {}'.format(dataset.id))
                if dataset.index_struct_dict:
                    if dataset.index_struct_dict['type'] == vector_type:
                        continue
                if vector_type == "weaviate":
                    dataset_id = dataset.id
                    collection_name = "Vector_index_" + dataset_id.replace("-", "_") + '_Node'
                    index_struct_dict = {
                        "type": 'weaviate',
                        "vector_store": {"class_prefix": collection_name}
                    }
                    dataset.index_struct = json.dumps(index_struct_dict)
                elif vector_type == "qdrant":
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
                        collection_name = "Vector_index_" + dataset_id.replace("-", "_") + '_Node'
                    index_struct_dict = {
                        "type": 'qdrant',
                        "vector_store": {"class_prefix": collection_name}
                    }
                    dataset.index_struct = json.dumps(index_struct_dict)

                elif vector_type == "milvus":
                    dataset_id = dataset.id
                    collection_name = "Vector_index_" + dataset_id.replace("-", "_") + '_Node'
                    index_struct_dict = {
                        "type": 'milvus',
                        "vector_store": {"class_prefix": collection_name}
                    }
                    dataset.index_struct = json.dumps(index_struct_dict)
                else:
                    raise ValueError(f"Vector store {config.get('VECTOR_STORE')} is not supported.")

                vector = Vector(dataset)
                click.echo(f"vdb_migrate {dataset.id}")

                try:
                    vector.delete()
                except Exception as e:
                    raise e

                dataset_documents = db.session.query(DatasetDocument).filter(
                    DatasetDocument.dataset_id == dataset.id,
                    DatasetDocument.indexing_status == 'completed',
                    DatasetDocument.enabled == True,
                    DatasetDocument.archived == False,
                ).all()

                documents = []
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

                if documents:
                    try:
                        vector.create(documents)
                    except Exception as e:
                        raise e
                click.echo(f"Dataset {dataset.id} create successfully.")
                db.session.add(dataset)
                db.session.commit()
                create_count += 1
            except Exception as e:
                db.session.rollback()
                click.echo(
                    click.style('Create dataset index error: {} {}'.format(e.__class__.__name__, str(e)),
                                fg='red'))
                continue

    click.echo(click.style('Congratulations! Create {} dataset indexes.'.format(create_count), fg='green'))


def register_commands(app):
    app.cli.add_command(reset_password)
    app.cli.add_command(reset_email)
    app.cli.add_command(reset_encrypt_key_pair)
    app.cli.add_command(vdb_migrate)
