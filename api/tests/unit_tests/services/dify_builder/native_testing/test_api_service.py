"""API composition cannot advertise an unqualified native execution path."""

import importlib.util

import pytest

from core.dify_builder.models import Actor
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError


def test_missing_qualification_refuses_start_before_admission():
    name = "services.dify_builder.native_testing.api_service"
    assert importlib.util.find_spec(name) is not None, "native API orchestration missing"
    module = __import__(name, fromlist=["NativeTestApiService"])
    service = module.NativeTestApiService(
        session_factory=None,
        actor=Actor(account_id="a", tenant_id="t"),
        resolver=None,
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=None,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_runtime_unavailable"):
        service.start(
            actor=Actor(account_id="a", tenant_id="t"),
            session_id="s",
            test_input_id="i",
            expected_version=1,
            mode="native",
            idempotency_key="k",
        )
