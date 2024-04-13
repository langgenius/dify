import os
import shutil
from collections.abc import Generator
from contextlib import closing
from datetime import datetime, timedelta, timezone
from typing import Union

import boto3
from azure.storage.blob import AccountSasPermissions, BlobServiceClient, ResourceTypes, generate_account_sas
from botocore.client import Config
from botocore.exceptions import ClientError
from flask import Flask


class Storage:
    def __init__(self):
        self.storage_type = None
        self.bucket_name = None
        self.client = None
        self.folder = None

    def init_app(self, app: Flask):
        self.storage_type = app.config.get('STORAGE_TYPE')
        if self.storage_type == 's3':
            self.bucket_name = app.config.get('S3_BUCKET_NAME')
            self.client = boto3.client(
                's3',
                aws_secret_access_key=app.config.get('S3_SECRET_KEY'),
                aws_access_key_id=app.config.get('S3_ACCESS_KEY'),
                endpoint_url=app.config.get('S3_ENDPOINT'),
                region_name=app.config.get('S3_REGION'),
                config=Config(s3={'addressing_style': app.config.get('S3_ADDRESS_STYLE')})
            )
        elif self.storage_type == 'azure-blob':
            self.bucket_name = app.config.get('AZURE_BLOB_CONTAINER_NAME')
            sas_token = generate_account_sas(
                account_name=app.config.get('AZURE_BLOB_ACCOUNT_NAME'),
                account_key=app.config.get('AZURE_BLOB_ACCOUNT_KEY'),
                resource_types=ResourceTypes(service=True, container=True, object=True),
                permission=AccountSasPermissions(read=True, write=True, delete=True, list=True, add=True, create=True),
                expiry=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)
            )
            self.client = BlobServiceClient(account_url=app.config.get('AZURE_BLOB_ACCOUNT_URL'),
                                            credential=sas_token)

        else:
            self.folder = app.config.get('STORAGE_LOCAL_PATH')
            if not os.path.isabs(self.folder):
                self.folder = os.path.join(app.root_path, self.folder)

    def save(self, filename, data):
        if self.storage_type == 's3':
            self.client.put_object(Bucket=self.bucket_name, Key=filename, Body=data)
        elif self.storage_type == 'azure-blob':
            blob_container = self.client.get_container_client(container=self.bucket_name)
            blob_container.upload_blob(filename, data)
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
