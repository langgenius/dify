from enum import StrEnum, auto


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
