import base64
import os
from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from typing import Union

import boto3
import oss2 as aliyun_s3
from azure.storage.blob import AccountSasPermissions, BlobServiceClient, ResourceTypes, generate_account_sas
from botocore.client import Config
from flask import Flask
from google.cloud import storage as GoogleStorage

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
        elif self.storage_type == 'google-storage':
            self.bucket_name = app.config.get('GOOGLE_STORAGE_BUCKET_NAME')
            service_account_json = base64.b64decode(app.config.get('GOOGLE_STORAGE_SERVICE_ACCOUNT_JSON_BASE64')).decode('utf-8')
            self.client = GoogleStorage.Client().from_service_account_json(service_account_json)
        else:
            folder = app.config.get('STORAGE_LOCAL_PATH')
            if not os.path.isabs(folder):
                folder = os.path.join(app.root_path, folder)
            self.storage_runner = LocalStorage(storage_type='local', folder=folder, bucket_name=None, client=None)

    def save(self, filename, data):
        if self.storage_type == 's3':
            self.client.put_object(Bucket=self.bucket_name, Key=filename, Body=data)
        elif self.storage_type == 'azure-blob':
            blob_container = self.client.get_container_client(container=self.bucket_name)
            blob_container.upload_blob(filename, data)
        elif self.storage_type == 'aliyun-oss':
            self.client.put_object(filename, data)
        elif self.storage_type == 'google-storage':
            bucket = self.client.get_bucket(self.bucket_name)
            blob = bucket.blob(filename)
            blob.upload_from_file(data)
        else:
            if not self.folder or self.folder.endswith('/'):
                filename = self.folder + filename
            else:
                filename = self.folder + '/' + filename

            folder = os.path.dirname(filename)
            os.makedirs(folder, exist_ok=True)

            with open(os.path.join(os.getcwd(), filename), "wb") as f:
                f.write(data)

    def load(self, filename: str, stream: bool = False) -> Union[bytes, Generator]:
        if stream:
            return self.load_stream(filename)
        else:
            return self.load_once(filename)

    def load_once(self, filename: str) -> bytes:
        if self.storage_type == 's3':
            try:
                with closing(self.client) as client:
                    data = client.get_object(Bucket=self.bucket_name, Key=filename)['Body'].read()
            except ClientError as ex:
                if ex.response['Error']['Code'] == 'NoSuchKey':
                    raise FileNotFoundError("File not found")
                else:
                    raise
        elif self.storage_type == 'azure-blob':
            blob = self.client.get_container_client(container=self.bucket_name)
            blob = blob.get_blob_client(blob=filename)
            data = blob.download_blob().readall()
        elif self.storage_type == 'aliyun-oss':
            with closing(self.client.get_object(filename)) as obj:
                data = obj.read()
        elif self.storage_type == 'google-storage':
            bucket = self.client.get_bucket(self.bucket_name)
            blob = bucket.get_blob(filename)
            data = blob.download_as_bytes()
        else:
            if not self.folder or self.folder.endswith('/'):
                filename = self.folder + filename
            else:
                filename = self.folder + '/' + filename

            if not os.path.exists(filename):
                raise FileNotFoundError("File not found")

            with open(filename, "rb") as f:
                data = f.read()

        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            if self.storage_type == 's3':
                try:
                    with closing(self.client) as client:
                        response = client.get_object(Bucket=self.bucket_name, Key=filename)
                        for chunk in response['Body'].iter_chunks():
                            yield chunk
                except ClientError as ex:
                    if ex.response['Error']['Code'] == 'NoSuchKey':
                        raise FileNotFoundError("File not found")
                    else:
                        raise
            elif self.storage_type == 'azure-blob':
                blob = self.client.get_blob_client(container=self.bucket_name, blob=filename)
                with closing(blob.download_blob()) as blob_stream:
                    while chunk := blob_stream.readall(4096):
                        yield chunk
            elif self.storage_type == 'aliyun-oss':
                with closing(self.client.get_object(filename)) as obj:
                    while chunk := obj.read(4096):
                        yield chunk
            elif self.storage_type == 'google-storage':
                bucket = self.client.get_bucket(self.bucket_name)
                blob = bucket.get_blob(filename)
                with closing(blob.open(mode='rb')) as blob_stream:
                    while chunk := blob_stream.read(4096):
                        yield chunk
            else:
                if not self.folder or self.folder.endswith('/'):
                    filename = self.folder + filename
                else:
                    filename = self.folder + '/' + filename

                if not os.path.exists(filename):
                    raise FileNotFoundError("File not found")

                with open(filename, "rb") as f:
                    while chunk := f.read(4096):  # Read in chunks of 4KB
                        yield chunk

        return generate()

    def download(self, filename, target_filepath):
        if self.storage_type == 's3':
            with closing(self.client) as client:
                client.download_file(self.bucket_name, filename, target_filepath)
        elif self.storage_type == 'azure-blob':
            blob = self.client.get_blob_client(container=self.bucket_name, blob=filename)
            with open(target_filepath, "wb") as my_blob:
                blob_data = blob.download_blob()
                blob_data.readinto(my_blob)
        elif self.storage_type == 'aliyun-oss':
            self.client.get_object_to_file(filename, target_filepath)
        elif self.storage_type == 'google-storage':
            bucket = self.client.get_bucket(self.bucket_name)
            blob = bucket.get_blob(filename)
            with open(target_filepath, "wb") as my_blob:
                blob_data = blob.download_blob()
                blob_data.readinto(my_blob)
        else:
            if not self.folder or self.folder.endswith('/'):
                filename = self.folder + filename
            else:
                filename = self.folder + '/' + filename

            if not os.path.exists(filename):
                raise FileNotFoundError("File not found")

            shutil.copyfile(filename, target_filepath)

    def exists(self, filename):
        if self.storage_type == 's3':
            with closing(self.client) as client:
                try:
                    client.head_object(Bucket=self.bucket_name, Key=filename)
                    return True
                except:
                    return False
        elif self.storage_type == 'azure-blob':
            blob = self.client.get_blob_client(container=self.bucket_name, blob=filename)
            return blob.exists()
        elif self.storage_type == 'aliyun-oss':
            return self.client.object_exists(filename)
        elif self.storage_type == 'google-storage':
            bucket = self.client.get_bucket(self.bucket_name)
            blob = bucket.blob(filename)
            return blob.exists()
        else:
            if not self.folder or self.folder.endswith('/'):
                filename = self.folder + filename
            else:
                filename = self.folder + '/' + filename

            return os.path.exists(filename)

    def delete(self, filename):
        if self.storage_type == 's3':
            self.client.delete_object(Bucket=self.bucket_name, Key=filename)
        elif self.storage_type == 'azure-blob':
            blob_container = self.client.get_container_client(container=self.bucket_name)
            blob_container.delete_blob(filename)
        elif self.storage_type == 'aliyun-oss':
            self.client.delete_object(filename)
        elif self.storage_type == 'google-storage':
            bucket = self.client.get_bucket(self.bucket_name)
            bucket.delete_blob(filename)
        else:
            if not self.folder or self.folder.endswith('/'):
                filename = self.folder + filename
            else:
                filename = self.folder + '/' + filename
            if os.path.exists(filename):
                os.remove(filename)


storage = Storage()


def init_app(app: Flask):
    storage.init_app(app)
