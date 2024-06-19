from enum import Enum


class DatasourceType(Enum):
    FILE = "upload_file"
    NOTION = "notion_import"
    LarkWiki = "larkwiki_import"
    WEBSITE = "website_crawl"
