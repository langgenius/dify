import dify_agent.server.schemas as server_schemas


def test_server_schemas_do_not_reexport_public_protocol_dtos() -> None:
    assert server_schemas.__all__ == ["RunRecord", "new_run_id"]
    assert not hasattr(server_schemas, "CreateRunRequest")
    assert not hasattr(server_schemas, "RunStartedEvent")


def test_server_schemas_keep_server_only_run_helpers() -> None:
    assert isinstance(server_schemas.new_run_id(), str)
    assert hasattr(server_schemas, "RunRecord")
