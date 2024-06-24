from enum import Enum


class DatasourceType(Enum):
    FILE = "upload_file"
    NOTION = "notion_import"
    FEISHUWIKI = "feishuwiki_import"
    WEBSITE = "website_crawl"
