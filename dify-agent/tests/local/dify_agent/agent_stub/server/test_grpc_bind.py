from __future__ import annotations

import pytest

from dify_agent.agent_stub.server.grpc_bind import derive_agent_stub_grpc_bind_target, parse_agent_stub_grpc_bind_address


def test_derive_agent_stub_grpc_bind_target_defaults_to_all_interfaces() -> None:
    target = derive_agent_stub_grpc_bind_target(public_url="grpc://agent.example.com:9091")

    assert target.host == "0.0.0.0"
    assert target.port == 9091
    assert target.address == "0.0.0.0:9091"


def test_derive_agent_stub_grpc_bind_target_prefers_explicit_override() -> None:
    target = derive_agent_stub_grpc_bind_target(
        public_url="grpc://agent.example.com:9091",
        bind_address="127.0.0.1:9191",
    )

    assert target.host == "127.0.0.1"
    assert target.port == 9191


def test_parse_agent_stub_grpc_bind_address_rejects_missing_port() -> None:
    with pytest.raises(ValueError, match="explicit port"):
        _ = parse_agent_stub_grpc_bind_address("127.0.0.1")


@pytest.mark.parametrize("value", ["user@0.0.0.0:9091", "user:password@0.0.0.0:9091"])
def test_parse_agent_stub_grpc_bind_address_rejects_user_info(value: str) -> None:
    with pytest.raises(ValueError, match="must not include user info"):
        _ = parse_agent_stub_grpc_bind_address(value)
