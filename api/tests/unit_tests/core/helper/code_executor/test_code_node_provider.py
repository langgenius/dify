from core.helper.code_executor.code_node_provider import CodeNodeProvider


class _DummyProvider(CodeNodeProvider):
    @staticmethod
    def get_language() -> str:
        return "dummy"

    @classmethod
    def get_default_code(cls) -> str:
        return "def main():\n    return {'result': 'ok'}"


def test_is_accept_language() -> None:
    assert _DummyProvider.is_accept_language("dummy") is True
    assert _DummyProvider.is_accept_language("other") is False


def test_get_default_config_contains_expected_shape() -> None:
    config = _DummyProvider.get_default_config()

    assert config["type"] == "code"
    assert config["config"]["code_language"] == "dummy"
    assert config["config"]["code"] == _DummyProvider.get_default_code()
    assert config["config"]["variables"] == [
        {"variable": "arg1", "value_selector": []},
        {"variable": "arg2", "value_selector": []},
    ]
    assert config["config"]["outputs"] == {"result": {"type": "string", "children": None}}
