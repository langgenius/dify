from enum import StrEnum


class AuthType(StrEnum):
    FIRECRAWL = "firecrawl"
    WATERCRAWL = "watercrawl"
    JINA = "jinareader"
