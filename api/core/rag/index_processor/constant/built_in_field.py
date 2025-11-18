import logging
from enum import StrEnum, auto

logger = logging.getLogger(__name__)


class BuiltInField(StrEnum):
    document_name = auto()
    uploader = auto()
    upload_date = auto()
    last_update_date = auto()
    source = auto()


class MetadataDataSource(StrEnum):
    upload_file = "file_upload"
    website_crawl = "website"
    notion_import = "notion"
    local_file = "file_upload"
    online_document = "online_document"
    online_drive = "online_drive"


def get_safe_data_source_value(data_source_type: str) -> str:
    """
    Safely get data source value for metadata.
    Returns the mapped value if exists in enum, otherwise returns the original value.

    Args:
        data_source_type: The data source type string

    Returns:
        The mapped enum value if exists, otherwise the original value
    """
    try:
        return MetadataDataSource[data_source_type].value
    except KeyError:
        logger.warning("Unknown data source type: %s, using original value", data_source_type)
        return data_source_type
