import pytest
from pydantic import ValidationError

from configs.middleware.vdb.opensearch_config import OpenSearchConfig
from tests.helpers.unit.configs._isolated_settings import InitSettingsOnly


class _IsolatedOpenSearchConfig(InitSettingsOnly, OpenSearchConfig):
    pass


def test_max_retries_defaults_to_the_client_default() -> None:
    assert _IsolatedOpenSearchConfig().OPENSEARCH_MAX_RETRIES == 3


def test_max_retries_accepts_zero_to_disable_retries() -> None:
    # opensearch-py's transport takes `max_retries=0`; a `PositiveInt` rejected it.
    config = _IsolatedOpenSearchConfig(OPENSEARCH_MAX_RETRIES=0)

    assert config.OPENSEARCH_MAX_RETRIES == 0


def test_max_retries_rejects_a_negative_count() -> None:
    with pytest.raises(ValidationError):
        _IsolatedOpenSearchConfig(OPENSEARCH_MAX_RETRIES=-1)
