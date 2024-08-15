# [REVIEW] Implement if Needed? Do we need a new type of data source
from abc import abstractmethod

import requests
from flask_login import current_user

from extensions.ext_database import db
from models.source import DataSourceBearerBinding


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
        TEST_CRAWL_SITE_URL = "https://www.google.com"
        FIRECRAWL_API_VERSION = "v0"

        test_api_endpoint = self.api_base_url.rstrip("/") + f"/{FIRECRAWL_API_VERSION}/scrape"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        data = {
            "url": TEST_CRAWL_SITE_URL,
        }

        response = requests.get(test_api_endpoint, headers=headers, json=data)

        return response.json().get("status") == "success"

    def save_credentials(self):
        # save data source binding
        data_source_binding = DataSourceBearerBinding.query.filter(
            db.and_(
                DataSourceBearerBinding.tenant_id == current_user.current_tenant_id,
                DataSourceBearerBinding.provider == "firecrawl",
                DataSourceBearerBinding.endpoint_url == self.api_base_url,
                DataSourceBearerBinding.bearer_key == self.api_key,
            )
        ).first()
        if data_source_binding:
            data_source_binding.disabled = False
            db.session.commit()
        else:
            new_data_source_binding = DataSourceBearerBinding(
                tenant_id=current_user.current_tenant_id,
                provider="firecrawl",
                endpoint_url=self.api_base_url,
                bearer_key=self.api_key,
            )
            db.session.add(new_data_source_binding)
            db.session.commit()
