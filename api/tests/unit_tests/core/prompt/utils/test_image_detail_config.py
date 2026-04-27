from unittest.mock import MagicMock

from graphon.file import FileType
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent

from core.prompt.utils.image_detail_config import image_detail_config_for_prompt_file


def test_image_detail_only_for_image_files():
    image_file = MagicMock()
    image_file.type = FileType.IMAGE
    doc_file = MagicMock()
    doc_file.type = FileType.DOCUMENT
    detail = ImagePromptMessageContent.DETAIL.HIGH

    assert image_detail_config_for_prompt_file(image_file, detail) is detail
    assert image_detail_config_for_prompt_file(doc_file, detail) is None
    assert image_detail_config_for_prompt_file(doc_file, None) is None
