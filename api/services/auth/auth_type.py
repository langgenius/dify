from enum import StrEnum


class AuthType(StrEnum):
    FIRECRAWL = "firecrawl"
    WATERCRAWL = "watercrawl"
    SCRAPFLY = "scrapfly"
    JINA = "jinareader"
