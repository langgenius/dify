import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.spark.spark import SparkProvider


def test_validate_provider_credentials():
    provider = SparkProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(
        credentials={
            "app_id": os.environ.get("SPARK_APP_ID"),
            "api_secret": os.environ.get("SPARK_API_SECRET"),
            "api_key": os.environ.get("SPARK_API_KEY"),
        }
    )
