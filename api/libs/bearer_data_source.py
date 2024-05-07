
# [REVIEW] Implement if Needed? Do we need a new type of data source
from abc import abstractmethod


class BearerDataSource:
    def __init__(self, api_key: str, api_base_url: str):
        self.api_key = api_key
        self.api_base_url = api_base_url

    @abstractmethod
    def validate_bearer_data_source(self):
        """
        Validate the data source
        """
    


class FireCrawlDataSource(BearerDataSource):
    def validate_bearer_data_source(self):
        
        pass