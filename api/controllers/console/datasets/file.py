import datetime
import hashlib
import tempfile
import chardet
import time
import uuid
from pathlib import Path

from cachetools import TTLCache
from flask import request, current_app
from flask_login import login_required, current_user
from flask_restful import Resource, marshal_with, fields
from werkzeug.exceptions import NotFound

from controllers.console import api
from controllers.console.datasets.error import NoFileUploadedError, TooManyFilesError, FileTooLargeError, \
    UnsupportedFileTypeError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.data_loader.file_extractor import FileExtractor
from extensions.ext_storage import storage
from libs.helper import TimestampField
from extensions.ext_database import db
from models.model import UploadFile

cache = TTLCache(maxsize=None, ttl=30)

FILE_SIZE_LIMIT = 15 * 1024 * 1024  # 15MB
ALLOWED_EXTENSIONS = ['txt', 'markdown', 'md', 'pdf', 'html', 'htm', 'xlsx']
PREVIEW_WORDS_LIMIT = 3000


class FileApi(Resource):
    file_fields = {
        'id': fields.String,
        'name': fields.String,
        'size': fields.Integer,
        'extension': fields.String,
        'mime_type': fields.String,
        'created_by': fields.String,
        'created_at': TimestampField,
    }

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(file_fields)
    def post(self):

        # get file from request
        file = request.files['file']

        # check file
        if 'file' not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        file_content = file.read()
        file_size = len(file_content)

        if file_size > FILE_SIZE_LIMIT:
            message = "({file_size} > {FILE_SIZE_LIMIT})"
            raise FileTooLargeError(message)

        extension = file.filename.split('.')[-1]
        if extension not in ALLOWED_EXTENSIONS:
            raise UnsupportedFileTypeError()

        # user uuid as file name
        file_uuid = str(uuid.uuid4())
        file_key = 'upload_files/' + current_user.current_tenant_id + '/' + file_uuid + '.' + extension

        # save file to storage
        storage.save(file_key, file_content)

        # save file to db
        config = current_app.config
        upload_file = UploadFile(
            tenant_id=current_user.current_tenant_id,
            storage_type=config['STORAGE_TYPE'],
            key=file_key,
            name=file.filename,
            size=file_size,
            extension=extension,
            mime_type=file.mimetype,
            created_by=current_user.id,
            created_at=datetime.datetime.utcnow(),
            used=False,
            hash=hashlib.sha3_256(file_content).hexdigest()
        )

        db.session.add(upload_file)
        db.session.commit()

        return upload_file, 201


class FilePreviewApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, file_id):
        file_id = str(file_id)

        key = file_id + request.path
        cached_response = cache.get(key)
        if cached_response and time.time() - cached_response['timestamp'] < cache.ttl:
            return cached_response['response']

        upload_file = db.session.query(UploadFile) \
            .filter(UploadFile.id == file_id) \
            .first()

        if not upload_file:
            raise NotFound("File not found")

        # extract text from file
        extension = upload_file.extension
        if extension not in ALLOWED_EXTENSIONS:
            raise UnsupportedFileTypeError()

        text = FileExtractor.load(upload_file, return_text=True)
        text = text[0:PREVIEW_WORDS_LIMIT] if text else ''
        return {'content': text}


api.add_resource(FileApi, '/files/upload')
api.add_resource(FilePreviewApi, '/files/<uuid:file_id>/preview')
