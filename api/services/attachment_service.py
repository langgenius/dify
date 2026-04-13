import base64

from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound

from extensions.ext_storage import storage
from models.model import UploadFile

PREVIEW_WORDS_LIMIT = 3000


class AttachmentService:
    _session_maker: sessionmaker

    def __init__(self, session_factory: sessionmaker | Engine | None = None):
        if isinstance(session_factory, Engine):
            self._session_maker = sessionmaker(bind=session_factory)
        elif isinstance(session_factory, sessionmaker):
            self._session_maker = session_factory
        else:
            raise AssertionError("must be a sessionmaker or an Engine.")

    def get_file_base64(self, file_id: str) -> str:
        upload_file = self._session_maker(expire_on_commit=False).scalar(
            select(UploadFile).where(UploadFile.id == file_id).limit(1)
        )
        if not upload_file:
            raise NotFound("File not found")
        blob = storage.load_once(upload_file.key)
        return base64.b64encode(blob).decode()
