from enum import Enum


class BuiltInField(str, Enum):
    document_name = "document_name"
    uploader = "uploader"
    upload_date = "upload_date"
    last_update_date = "last_update_date"
    source = "source"


class MetadataDataSource(Enum):
    upload_file = "file_upload"
    website_crawl = "website"
    notion_import = "notion"
