import pytest

from services.auth.auth_type import AuthType


class TestAuthType:
    """Test cases for AuthType enum"""

    def test_auth_type_is_str_enum(self):
        """Test that AuthType is properly a StrEnum"""
        assert issubclass(AuthType, str)
        assert hasattr(AuthType, "__members__")

    def test_auth_type_has_expected_values(self):
        """Test that all expected auth types exist with correct values"""
        expected_values = {
            "FIRECRAWL": "firecrawl",
            "WATERCRAWL": "watercrawl",
            "JINA": "jinareader",
        }

        # Verify all expected members exist
        for member_name, expected_value in expected_values.items():
            assert hasattr(AuthType, member_name)
            assert getattr(AuthType, member_name).value == expected_value

        # Verify no extra members exist
        assert len(AuthType) == len(expected_values)

    @pytest.mark.parametrize(
        ("auth_type", "expected_string"),
        [
            (AuthType.FIRECRAWL, "firecrawl"),
            (AuthType.WATERCRAWL, "watercrawl"),
            (AuthType.JINA, "jinareader"),
        ],
    )
    def test_auth_type_string_representation(self, auth_type, expected_string):
        """Test string representation of auth types"""
        assert str(auth_type) == expected_string
        assert auth_type.value == expected_string

    @pytest.mark.parametrize(
        ("auth_type", "compare_value", "expected_result"),
        [
            (AuthType.FIRECRAWL, "firecrawl", True),
            (AuthType.WATERCRAWL, "watercrawl", True),
            (AuthType.JINA, "jinareader", True),
            (AuthType.FIRECRAWL, "FIRECRAWL", False),  # Case sensitive
            (AuthType.FIRECRAWL, "watercrawl", False),
            (AuthType.JINA, "jina", False),  # Full value mismatch
        ],
    )
    def test_auth_type_comparison(self, auth_type, compare_value, expected_result):
        """Test auth type comparison with strings"""
        assert (auth_type == compare_value) is expected_result

    def test_auth_type_iteration(self):
        """Test that AuthType can be iterated over"""
        auth_types = list(AuthType)
        assert len(auth_types) == 3
        assert AuthType.FIRECRAWL in auth_types
        assert AuthType.WATERCRAWL in auth_types
        assert AuthType.JINA in auth_types

    def test_auth_type_membership(self):
        """Test membership checking for AuthType"""
        assert "firecrawl" in [auth.value for auth in AuthType]
        assert "watercrawl" in [auth.value for auth in AuthType]
        assert "jinareader" in [auth.value for auth in AuthType]
        assert "invalid" not in [auth.value for auth in AuthType]

    def test_auth_type_invalid_attribute_access(self):
        """Test accessing non-existent auth type raises AttributeError"""
        with pytest.raises(AttributeError):
            _ = AuthType.INVALID_TYPE

    def test_auth_type_immutability(self):
        """Test that enum values cannot be modified"""
        # In Python 3.11+, enum members are read-only
        with pytest.raises(AttributeError):
            AuthType.FIRECRAWL = "modified"

    def test_auth_type_from_value(self):
        """Test creating AuthType from string value"""
        assert AuthType("firecrawl") == AuthType.FIRECRAWL
        assert AuthType("watercrawl") == AuthType.WATERCRAWL
        assert AuthType("jinareader") == AuthType.JINA

        # Test invalid value
        with pytest.raises(ValueError) as exc_info:
            AuthType("invalid_auth_type")
        assert "invalid_auth_type" in str(exc_info.value)

    def test_auth_type_name_property(self):
        """Test the name property of enum members"""
        assert AuthType.FIRECRAWL.name == "FIRECRAWL"
        assert AuthType.WATERCRAWL.name == "WATERCRAWL"
        assert AuthType.JINA.name == "JINA"

    @pytest.mark.parametrize(
        "auth_type",
        [AuthType.FIRECRAWL, AuthType.WATERCRAWL, AuthType.JINA],
    )
    def test_auth_type_isinstance_checks(self, auth_type):
        """Test isinstance checks for auth types"""
        assert isinstance(auth_type, AuthType)
        assert isinstance(auth_type, str)
        assert isinstance(auth_type.value, str)

    def test_auth_type_hash(self):
        """Test that auth types are hashable and can be used in sets/dicts"""
        auth_set = {AuthType.FIRECRAWL, AuthType.WATERCRAWL, AuthType.JINA}
        assert len(auth_set) == 3

        auth_dict = {
            AuthType.FIRECRAWL: "firecrawl_handler",
            AuthType.WATERCRAWL: "watercrawl_handler",
            AuthType.JINA: "jina_handler",
        }
        assert auth_dict[AuthType.FIRECRAWL] == "firecrawl_handler"

    def test_auth_type_json_serializable(self):
        """Test that auth types can be JSON serialized"""
        import json

        auth_data = {
            "provider": AuthType.FIRECRAWL,
            "enabled": True,
        }

        # Should serialize to string value
        json_str = json.dumps(auth_data, default=str)
        assert '"provider": "firecrawl"' in json_str

    def test_auth_type_matches_factory_usage(self):
        """Test that all AuthType values are handled by ApiKeyAuthFactory"""
        # This test verifies that the enum values match what's expected
        # by the factory implementation
        from services.auth.api_key_auth_factory import ApiKeyAuthFactory

        for auth_type in AuthType:
            # Should not raise ValueError for valid auth types
            try:
                auth_class = ApiKeyAuthFactory.get_apikey_auth_factory(auth_type)
                assert auth_class is not None
            except ImportError:
                # It's OK if the actual auth implementation doesn't exist
                # We're just testing that the enum value is recognized
                pass
