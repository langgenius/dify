"""Unit tests for the per-app Engram feature config manager."""

import pytest

from core.app.app_config.features.engram.manager import EngramConfigManager


class TestConvert:
    def test_none_when_absent(self):
        assert EngramConfigManager.convert({}) is None

    def test_builds_entity(self):
        entity = EngramConfigManager.convert(
            {"engram": {"enabled": True, "api_key": "enc-key", "endpoint": "https://e"}}
        )
        assert entity is not None
        assert entity.enabled is True
        assert entity.api_key == "enc-key"
        assert entity.endpoint == "https://e"

    def test_blank_fields_become_none(self):
        entity = EngramConfigManager.convert({"engram": {"enabled": True, "api_key": "", "endpoint": ""}})
        assert entity is not None
        assert entity.api_key is None
        assert entity.endpoint is None


class TestValidateAndSetDefaults:
    def test_sets_disabled_default_when_absent(self):
        config, keys = EngramConfigManager.validate_and_set_defaults({})
        assert keys == ["engram"]
        assert config["engram"] == {"enabled": False, "api_key": "", "endpoint": ""}

    def test_normalizes_present_config(self):
        config, keys = EngramConfigManager.validate_and_set_defaults(
            {"engram": {"enabled": True, "api_key": "k", "endpoint": "https://e"}}
        )
        assert keys == ["engram"]
        assert config["engram"] == {"enabled": True, "api_key": "k", "endpoint": "https://e"}

    def test_rejects_non_dict(self):
        with pytest.raises(ValueError, match="object type"):
            EngramConfigManager.validate_and_set_defaults({"engram": "nope"})

    def test_rejects_non_bool_enabled(self):
        with pytest.raises(ValueError, match="boolean type"):
            EngramConfigManager.validate_and_set_defaults({"engram": {"enabled": "yes"}})
