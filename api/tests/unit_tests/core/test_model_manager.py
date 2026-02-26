from unittest.mock import MagicMock, patch

import pytest
import redis
from pytest_mock import MockerFixture

from core.entities.provider_entities import ModelLoadBalancingConfiguration
from core.model_manager import LBModelManager
from core.model_runtime.entities.model_entities import ModelType
from extensions.ext_redis import redis_client


@pytest.fixture
def lb_model_manager():
    load_balancing_configs = [
        ModelLoadBalancingConfiguration(id="id1", name="__inherit__", credentials={}),
        ModelLoadBalancingConfiguration(id="id2", name="first", credentials={"openai_api_key": "fake_key"}),
        ModelLoadBalancingConfiguration(id="id3", name="second", credentials={"openai_api_key": "fake_key"}),
    ]

    lb_model_manager = LBModelManager(
        tenant_id="tenant_id",
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4",
        load_balancing_configs=load_balancing_configs,
        managed_credentials={"openai_api_key": "fake_key"},
    )

    lb_model_manager.cooldown = MagicMock(return_value=None)

    def is_cooldown(config: ModelLoadBalancingConfiguration):
        if config.id == "id1":
            return True

        return False

    lb_model_manager.in_cooldown = MagicMock(side_effect=is_cooldown)

    return lb_model_manager


def test_lb_model_manager_fetch_next(mocker: MockerFixture, lb_model_manager: LBModelManager):
    # initialize redis client
    redis_client.initialize(redis.Redis())

    assert len(lb_model_manager._load_balancing_configs) == 3

    config1 = lb_model_manager._load_balancing_configs[0]
    config2 = lb_model_manager._load_balancing_configs[1]
    config3 = lb_model_manager._load_balancing_configs[2]

    assert lb_model_manager.in_cooldown(config1) is True
    assert lb_model_manager.in_cooldown(config2) is False
    assert lb_model_manager.in_cooldown(config3) is False

    start_index = 0

    def incr(key):
        nonlocal start_index
        start_index += 1
        return start_index

    with (
        patch.object(redis_client, "incr", side_effect=incr),
        patch.object(redis_client, "set", return_value=None),
        patch.object(redis_client, "expire", return_value=None),
    ):
        config = lb_model_manager.fetch_next()
        assert config == config2

        config = lb_model_manager.fetch_next()
        assert config == config3
