import datetime
import hashlib
import uuid
from typing import Generator, Tuple, Union

from flask import current_app
from flask_login import current_user
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import NotFound

from core.data_loader.file_extractor import FileExtractor
from core.file.upload_file_parser import UploadFileParser
from extensions.ext_storage import storage
from extensions.ext_database import db
from models.account import Account
from models.model import UploadFile, EndUser
from services.errors.file import FileTooLargeError, UnsupportedFileTypeError

ALLOWED_EXTENSIONS = ['txt', 'markdown', 'md', 'pdf', 'html', 'htm', 'xlsx', 'docx', 'csv',
                      'jpg', 'jpeg', 'png', 'webp', 'gif']
IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']
PREVIEW_WORDS_LIMIT = 3000


class FileService:

    @staticmethod
    def upload_file(file: FileStorage, user: Union[Account, EndUser], only_image: bool = False) -> UploadFile:
        extension = file.filename.split('.')[-1]
        if extension.lower() not in ALLOWED_EXTENSIONS:
            raise UnsupportedFileTypeError()
        elif only_image and extension.lower() not in IMAGE_EXTENSIONS:
            raise UnsupportedFileTypeError()

        # read file content
        file_content = file.read()

        # get file size
        file_size = len(file_content)

        if extension.lower() in IMAGE_EXTENSIONS:
            file_size_limit = current_app.config.get("UPLOAD_IMAGE_FILE_SIZE_LIMIT") * 1024 * 1024
        else:
            file_size_limit = current_app.config.get("UPLOAD_FILE_SIZE_LIMIT") * 1024 * 1024

        if file_size > file_size_limit:
            message = f'File size exceeded. {file_size} > {file_size_limit}'
            raise FileTooLargeError(message)

        # user uuid as file name
        file_uuid = str(uuid.uuid4())

        if isinstance(user, Account):
            current_tenant_id = user.current_tenant_id
        else:
            # end_user
            current_tenant_id = user.tenant_id

        file_key = 'upload_files/' + current_tenant_id + '/' + file_uuid + '.' + extension

        # save file to storage
        storage.save(file_key, file_content)

        # save file to db
        config = current_app.config
        upload_file = UploadFile(
            tenant_id=current_tenant_id,
            storage_type=config['STORAGE_TYPE'],
            key=file_key,
            name=file.filename,
            size=file_size,
            extension=extension,
            mime_type=file.mimetype,
            created_by_role=('account' if isinstance(user, Account) else 'end_user'),
            created_by=user.id,
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

    @staticmethod
    def get_image_preview(file_id: str, timestamp: str, nonce: str, sign: str) -> Tuple[Generator, str]:
        result = UploadFileParser.verify_image_file_signature(file_id, timestamp, nonce, sign)
        if not result:
            raise NotFound("File not found or signature is invalid")

        upload_file = db.session.query(UploadFile) \
            .filter(UploadFile.id == file_id) \
            .first()

        if not upload_file:
            raise NotFound("File not found or signature is invalid")

        # extract text from file
        extension = upload_file.extension
        if extension.lower() not in IMAGE_EXTENSIONS:
            raise UnsupportedFileTypeError()

        generator = storage.load(upload_file.key, stream=True)

        return generator, upload_file.mime_type
