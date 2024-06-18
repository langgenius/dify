from enum import Enum


class DatasourceType(Enum):
    FILE = "upload_file"
    NOTION = "notion_import"
    LarkWike = "larkwiki_import"
    WEBSITE = "website_crawl"
