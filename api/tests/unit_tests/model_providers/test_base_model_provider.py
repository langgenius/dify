from unittest.mock import MagicMock

import pytest

from core.model_providers.error import QuotaExceededError
from core.model_providers.models.entity.model_params import ModelType
from models.provider import Provider, ProviderType
from tests.unit_tests.model_providers.fake_model_provider import FakeModelProvider


def test_get_supported_model_list(mocker):
    mocker.patch.object(
        FakeModelProvider,
        'get_rules',
        return_value={'support_provider_types': ['custom'], 'model_flexibility': 'configurable'}
    )

    mock_provider_model = MagicMock()
    mock_provider_model.model_name = 'test_model'
    mock_query = MagicMock()
    mock_query.filter.return_value.order_by.return_value.all.return_value = [mock_provider_model]
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    provider = FakeModelProvider(provider=Provider())
    result = provider.get_supported_model_list(ModelType.TEXT_GENERATION)

    assert result == [{'id': 'test_model', 'name': 'test_model'}]


def test_check_quota_over_limit(mocker):
    mocker.patch.object(
        FakeModelProvider,
        'get_rules',
        return_value={'support_provider_types': ['system']}
    )

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = None
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    provider = FakeModelProvider(provider=Provider(provider_type=ProviderType.SYSTEM.value))

    with pytest.raises(QuotaExceededError):
        provider.check_quota_over_limit()


def test_check_quota_not_over_limit(mocker):
    mocker.patch.object(
        FakeModelProvider,
        'get_rules',
        return_value={'support_provider_types': ['system']}
    )

    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = Provider()
    mocker.patch('extensions.ext_database.db.session.query', return_value=mock_query)

    provider = FakeModelProvider(provider=Provider(provider_type=ProviderType.SYSTEM.value))

    assert provider.check_quota_over_limit() is None


def test_check_custom_quota_over_limit(mocker):
    mocker.patch.object(
        FakeModelProvider,
        'get_rules',
        return_value={'support_provider_types': ['custom']}
    )

    provider = FakeModelProvider(provider=Provider(provider_type=ProviderType.CUSTOM.value))

    assert provider.check_quota_over_limit() is None
