from enum import Enum


class AuthType(str, Enum):
    FIRECRAWL = "firecrawl"
    JINA = "jinareader"
