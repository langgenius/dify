import os
import shutil
from collections.abc import Generator
from contextlib import closing
from typing import Union

import boto3
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
                region_name=app.config.get('S3_REGION')
            )
        else:
            self.folder = app.config.get('STORAGE_LOCAL_PATH')
            if not os.path.isabs(self.folder):
                self.folder = os.path.join(app.root_path, self.folder)

    def save(self, filename, data):
        if self.storage_type == 's3':
            self.client.put_object(Bucket=self.bucket_name, Key=filename, Body=data)
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
        else:
            if not self.folder or self.folder.endswith('/'):
                filename = self.folder + filename
            else:
                filename = self.folder + '/' + filename

            return os.path.exists(filename)


storage = Storage()


def init_app(app: Flask):
    storage.init_app(app)
