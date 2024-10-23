import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.analyticdb.analyticdb import AnalyticdbProvider


def test_validate_provider_credentials():
    provider = AnalyticdbProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})
    provider.validate_provider_credentials(
        credentials={
            "access_key_id": os.environ.get("ANALYTICDB_KEY_ID"),
            "access_key_secret": os.environ.get("ANALYTICDB_KEY_SECRET"),
            "region_id": os.environ.get("ANALYTICDB_REGION_ID"),
            "instance_id": os.environ.get("ANALYTICDB_INSTANCE_ID"),
        }
    )
