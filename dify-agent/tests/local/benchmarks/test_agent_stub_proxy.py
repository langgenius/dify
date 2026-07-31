from benchmarks.agent_stub_proxy import create_app


def test_proxy_exposes_only_health_agent_stub_and_file_data() -> None:
    routes = {path for route in create_app().routes if isinstance(path := getattr(route, "path", None), str)}

    assert "/health" in routes
    assert "/agent-stub/{path:path}" in routes
    assert "/benchmark-data/files/{path:path}" in routes
    assert all("drive" not in route for route in routes)
