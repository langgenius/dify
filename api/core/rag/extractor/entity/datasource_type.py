from enum import StrEnum


class DatasourceType(StrEnum):
    FILE = "upload_file"
    NOTION = "notion_import"
    WEBSITE = "website_crawl"
