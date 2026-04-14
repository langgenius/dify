from graphon.file import File, FileType
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent


def image_detail_config_for_prompt_file(
    file: File,
    image_detail_config: ImagePromptMessageContent.DETAIL | None,
) -> ImagePromptMessageContent.DETAIL | None:
    if file.type == FileType.IMAGE:
        return image_detail_config
    return None
