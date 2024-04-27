import os
from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from typing import Union

import boto3
import oss2 as aliyun_s3
from azure.storage.blob import AccountSasPermissions, BlobServiceClient, ResourceTypes, generate_account_sas
from botocore.client import Config
from flask import Flask

from extensions.storage.aliyun_storage import AliyunStorage
from extensions.storage.azure_storage import AzureStorage
from extensions.storage.local_storage import LocalStorage
from extensions.storage.s3_storage import S3Storage


class Storage:
    def __init__(self):
        self.storage_runner = None

    def init_app(self, app: Flask):
        storage_type = app.config.get('STORAGE_TYPE')
        if storage_type == 's3':
            self.storage_runner = S3Storage(
                storage_type='s3',
                bucket_name=app.config.get('S3_BUCKET_NAME'),
                client=boto3.client(
                    's3',
                    aws_secret_access_key=app.config.get('S3_SECRET_KEY'),
                    aws_access_key_id=app.config.get('S3_ACCESS_KEY'),
                    endpoint_url=app.config.get('S3_ENDPOINT'),
                    region_name=app.config.get('S3_REGION'),
                    config=Config(s3={'addressing_style': app.config.get('S3_ADDRESS_STYLE')})
                ),
                folder=None
            )
        elif storage_type == 'azure-blob':
            sas_token = generate_account_sas(
                account_name=app.config.get('AZURE_BLOB_ACCOUNT_NAME'),
                account_key=app.config.get('AZURE_BLOB_ACCOUNT_KEY'),
                resource_types=ResourceTypes(service=True, container=True, object=True),
                permission=AccountSasPermissions(read=True, write=True, delete=True, list=True, add=True, create=True),
                expiry=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)
            )
            self.storage_runner = AzureStorage(
                storage_type='azure-blob',
                bucket_name=app.config.get('AZURE_BLOB_CONTAINER_NAME'),
                client=BlobServiceClient(account_url=app.config.get('AZURE_BLOB_ACCOUNT_URL'),
                                         credential=sas_token),
                folder=None
            )
        elif storage_type == 'aliyun-oss':
            self.storage_runner = AliyunStorage(
                storage_type='aliyun-oss',
                bucket_name=app.config.get('ALIYUN_OSS_BUCKET_NAME'),
                client=aliyun_s3.Bucket(
                    aliyun_s3.Auth(app.config.get('ALIYUN_OSS_ACCESS_KEY'), app.config.get('ALIYUN_OSS_SECRET_KEY')),
                    app.config.get('ALIYUN_OSS_ENDPOINT'),
                    app.config.get('ALIYUN_OSS_BUCKET_NAME'),
                    connect_timeout=30
                ),
                folder=None
            )
        else:
            folder = app.config.get('STORAGE_LOCAL_PATH')
            if not os.path.isabs(folder):
                folder = os.path.join(app.root_path, folder)
            self.storage_runner = LocalStorage(storage_type='local', folder=folder, bucket_name=None, client=None)

    def save(self, filename, data):
        self.storage_runner.save(filename, data)

    def load(self, filename: str, stream: bool = False) -> Union[bytes, Generator]:
        if stream:
            return self.load_stream(filename)
        else:
            return self.load_once(filename)

    def load_once(self, filename: str) -> bytes:
        return self.storage_runner.load_once(filename)

    def load_stream(self, filename: str) -> Generator:
        return self.storage_runner.load_stream(filename)

    def download(self, filename, target_filepath):
        self.storage_runner.download(filename, target_filepath)

    def exists(self, filename):
        return self.storage_runner.exists(filename)

    def delete(self, filename):
        self.storage_runner.delete(filename)


storage = Storage()


def init_app(app: Flask):
    storage.init_app(app)
