from core.model_providers.models.entity.message import PromptMessageFileType
from extensions.ext_database import db
from models.model import Message, MessageFile


class MessageFileService:

    @staticmethod
    def assemble_message_files(messages: list[Message]) -> None:
        for message in messages:
            message.message_files = db.session.query(MessageFile) \
                .filter(
                message.id == MessageFile.message_id,
                MessageFile.type == PromptMessageFileType.IMAGE.value) \
                .all()
