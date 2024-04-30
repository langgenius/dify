from typing import Iterator, Literal, Optional

# [REVIEW] Implement if Needed? Do we need a new type of data source
class BearerDataSource:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def access_token(self) -> str:
        raise NotImplementedError()


class FireCrawlDataSource(BearerDataSource):
    # [REVIEW] Implement if Needed? Do we need a new type of data source
    pass