"""Mutable port model defaults stay isolated and actors carry no forwarded tokens."""

from core.dify_builder.models import (
    Actor,
)


def test_actor_replaces_forward_auth_on_dify_port_methods() -> None:
    # Actor identifies the caller without carrying forwarded console tokens.
    actor = Actor(account_id="acc-1", tenant_id="tenant-1")
    assert not hasattr(actor, "auth")
    assert not hasattr(actor, "bearer")
