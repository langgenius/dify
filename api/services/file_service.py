import datetime
import hashlib
import time
import uuid

from cachetools import TTLCache
from flask import request, current_app
from flask_login import current_user
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import NotFound

from core.data_loader.file_extractor import FileExtractor
from extensions.ext_storage import storage
from extensions.ext_database import db
from models.model import UploadFile
from services.errors.file import FileTooLargeError, UnsupportedFileTypeError

ALLOWED_EXTENSIONS = ['txt', 'markdown', 'md', 'pdf', 'html', 'htm', 'xlsx', 'docx', 'csv']
PREVIEW_WORDS_LIMIT = 3000
cache = TTLCache(maxsize=None, ttl=30)


class FileService:

    @staticmethod
    def upload_file(file: FileStorage) -> UploadFile:
        # read file content
        file_content = file.read()
        # get file size
        file_size = len(file_content)

        file_size_limit = current_app.config.get("UPLOAD_FILE_SIZE_LIMIT") * 1024 * 1024
        if file_size > file_size_limit:
            message = f'File size exceeded. {file_size} > {file_size_limit}'
            raise FileTooLargeError(message)

        extension = file.filename.split('.')[-1]
        if extension.lower() not in ALLOWED_EXTENSIONS:
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

        return upload_file

    @staticmethod
    def upload_text(text: str, text_name: str) -> UploadFile:
        # user uuid as file name
        file_uuid = str(uuid.uuid4())
        file_key = 'upload_files/' + current_user.current_tenant_id + '/' + file_uuid + '.txt'

        # save file to storage
        storage.save(file_key, text.encode('utf-8'))

        # save file to db
        config = current_app.config
        upload_file = UploadFile(
            tenant_id=current_user.current_tenant_id,
            storage_type=config['STORAGE_TYPE'],
            key=file_key,
            name=text_name + '.txt',
            size=len(text),
            extension='txt',
            mime_type='text/plain',
            created_by=current_user.id,
            created_at=datetime.datetime.utcnow(),
            used=True,
            used_by=current_user.id,
            used_at=datetime.datetime.utcnow()
        )

        db.session.add(upload_file)
        db.session.commit()

        return upload_file

    @staticmethod
    def get_file_preview(file_id: str) -> str:
        # get file storage key
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
        if extension.lower() not in ALLOWED_EXTENSIONS:
            raise UnsupportedFileTypeError()

        text = FileExtractor.load(upload_file, return_text=True)
        text = text[0:PREVIEW_WORDS_LIMIT] if text else ''

        return text
