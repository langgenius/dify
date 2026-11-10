from services.dify_builder.native_launch_observation import NativeLaunchObservation, begin_preparation, mark_dispatched


def test_only_instrumented_preparation_proves_no_worker_dispatch() -> None:
    observation = NativeLaunchObservation()
    assert not observation.failed_before_dispatch
    with observation.track():
        begin_preparation()
        assert observation.failed_before_dispatch
        mark_dispatched()
        assert not observation.failed_before_dispatch
    # Out-of-scope ordinary native calls cannot alter this attempt.
    begin_preparation()
    assert observation.dispatched


def test_nested_launch_observations_do_not_replace_parent() -> None:
    outer, inner = NativeLaunchObservation(), NativeLaunchObservation()
    with outer.track():
        begin_preparation()
        with inner.track():
            begin_preparation()
            mark_dispatched()
        assert outer.failed_before_dispatch
        mark_dispatched()
    assert outer.dispatched
    assert inner.dispatched


def test_handled_metadata_failure_cannot_label_an_unrelated_later_error() -> None:
    from services.dify_builder.native_launch_observation import observe_resource

    observation = NativeLaunchObservation()
    with observation.track():
        import pytest

        with pytest.raises(ConnectionRefusedError, match="private") as caught:
            with observe_resource("model", "provider", "model"):
                raise ConnectionRefusedError("private")
        assert observation.resource_for(caught.value) == ("model", "provider", "model")
        assert observation.resource_for(ValueError("unrelated input error")) is None


def test_known_but_invalid_failure_node_does_not_attribute_other_same_provider_nodes() -> None:
    import pytest

    from services.dify_builder.native_launch_observation import observe_resource

    graph = {"nodes": [{"id": "other", "data": {"type": "tool", "provider_id": "provider", "tool_name": "action"}}]}
    observation = NativeLaunchObservation()
    with observation.track():
        with pytest.raises(ValueError, match="private") as caught:
            with observe_resource("tool", "provider", "action", node_id="invalid node"):
                raise ValueError("private")
    assert observation.node_ids_for(caught.value, graph) == ()
