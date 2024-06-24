from enum import Enum


class DatasourceType(Enum):
    FILE = "upload_file"
    NOTION = "notion_import"
    FEISHU_WIKI = "feishuwiki_import"
    WEBSITE = "website_crawl"
