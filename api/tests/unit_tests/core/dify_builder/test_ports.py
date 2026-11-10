"""Mutable port model defaults stay isolated and actors carry no forwarded tokens."""

from core.dify_builder.models import (
    Actor,
    ApplyResult,
    ChangeSet,
    MutationIntent,
)


def test_mutation_intent_defaults_and_args_not_shared() -> None:
    m1 = MutationIntent(op="set_node_config")
    m2 = MutationIntent(op="set_node_config")
    assert m1.args == {}
    m1.args["path"] = "code"
    assert m2.args == {}


def test_change_set_defaults_and_changed_nodes_not_shared() -> None:
    c1 = ChangeSet()
    c2 = ChangeSet()
    assert c1.changed_nodes == []
    assert c1.diff == ""
    c1.changed_nodes.append("n1")
    assert c2.changed_nodes == []


def test_apply_result_defaults_and_changed_nodes_not_shared() -> None:
    a1 = ApplyResult()
    a2 = ApplyResult()
    assert a1.changed_nodes == []
    assert a1.new_hash == ""
    a1.changed_nodes.append("n1")
    assert a2.changed_nodes == []


def test_actor_replaces_forward_auth_on_dify_port_methods() -> None:
    # Actor identifies the caller without carrying forwarded console tokens.
    actor = Actor(account_id="acc-1", tenant_id="tenant-1")
    assert not hasattr(actor, "auth")
    assert not hasattr(actor, "bearer")
