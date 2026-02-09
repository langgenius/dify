import pytest

from libs.attr_map import AttrKey, AttrMap, AttrMapKeyError, AttrMapTypeError


class TestAttrKey:
    def test_identity_based_equality(self):
        key1 = AttrKey("session", str)
        key2 = AttrKey("session", str)

        assert key1 != key2
        assert key1 == key1

    def test_identity_based_hash(self):
        key1 = AttrKey("session", str)
        key2 = AttrKey("session", str)

        assert hash(key1) != hash(key2)
        assert hash(key1) == hash(key1)

    def test_can_be_used_as_dict_key(self):
        key1 = AttrKey("session", str)
        key2 = AttrKey("session", str)
        data: dict[AttrKey[str], str] = {}

        data[key1] = "value1"
        data[key2] = "value2"

        assert data[key1] == "value1"
        assert data[key2] == "value2"
        assert len(data) == 2

    def test_properties(self):
        key = AttrKey("my_key", int)

        assert key.name == "my_key"
        assert key.type_ is int

    def test_repr(self):
        key = AttrKey("session", str)
        assert repr(key) == "AttrKey('session', str)"


class TestAttrMap:
    def test_set_and_get(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        attrs.set(key, "hello")
        result = attrs.get(key)

        assert result == "hello"

    def test_get_raises_when_not_set(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        with pytest.raises(AttrMapKeyError) as exc_info:
            attrs.get(key)

        assert exc_info.value.key is key

    def test_get_or_none_returns_none_for_missing(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        assert attrs.get_or_none(key) is None

    def test_get_or_none_returns_value_when_set(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()
        attrs.set(key, "hello")

        assert attrs.get_or_none(key) == "hello"

    def test_get_or_default_returns_value_when_set(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()
        attrs.set(key, "hello")

        result = attrs.get_or_default(key, "default")

        assert result == "hello"

    def test_get_or_default_returns_default_when_not_set(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        result = attrs.get_or_default(key, "default")

        assert result == "default"

    def test_has(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        assert not attrs.has(key)

        attrs.set(key, "hello")

        assert attrs.has(key)

    def test_remove_existing(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()
        attrs.set(key, "hello")

        result = attrs.remove(key)

        assert result is True
        assert not attrs.has(key)

    def test_remove_non_existing(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        result = attrs.remove(key)

        assert result is False

    def test_set_if_absent_when_absent(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        result = attrs.set_if_absent(key, "first")

        assert result == "first"
        assert attrs.get(key) == "first"

    def test_set_if_absent_when_present(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()
        attrs.set(key, "existing")

        result = attrs.set_if_absent(key, "new")

        assert result == "existing"
        assert attrs.get(key) == "existing"

    def test_clear(self):
        key1: AttrKey[str] = AttrKey("key1", str)
        key2: AttrKey[int] = AttrKey("key2", int)
        attrs = AttrMap()
        attrs.set(key1, "hello")
        attrs.set(key2, 42)

        attrs.clear()

        assert len(attrs) == 0
        assert not attrs.has(key1)
        assert not attrs.has(key2)

    def test_len(self):
        key1: AttrKey[str] = AttrKey("key1", str)
        key2: AttrKey[int] = AttrKey("key2", int)
        attrs = AttrMap()

        assert len(attrs) == 0

        attrs.set(key1, "hello")
        assert len(attrs) == 1

        attrs.set(key2, 42)
        assert len(attrs) == 2

    def test_repr(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()
        attrs.set(key, "hello")

        result = repr(attrs)

        assert "AttrMap" in result
        assert "session" in result


class TestAttrMapTypeValidation:
    def test_set_with_wrong_type_raises(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        with pytest.raises(AttrMapTypeError) as exc_info:
            attrs.set(key, 123)  # type: ignore[arg-type]

        assert exc_info.value.key is key
        assert exc_info.value.expected_type is str
        assert exc_info.value.actual_type is int

    def test_set_with_validate_false_allows_wrong_type(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        attrs.set(key, 123, validate=False)  # type: ignore[arg-type]

        assert attrs.get(key) == 123

    def test_set_if_absent_with_wrong_type_raises(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        with pytest.raises(AttrMapTypeError):
            attrs.set_if_absent(key, 123)  # type: ignore[arg-type]

    def test_set_if_absent_with_validate_false_allows_wrong_type(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs = AttrMap()

        attrs.set_if_absent(key, 123, validate=False)  # type: ignore[arg-type]

        assert attrs.get(key) == 123

    def test_subclass_type_validation(self):
        class Animal:
            pass

        class Dog(Animal):
            pass

        key: AttrKey[Animal] = AttrKey("animal", Animal)
        attrs = AttrMap()

        attrs.set(key, Dog())

        assert isinstance(attrs.get(key), Dog)


class TestAttrMapIsolation:
    def test_different_keys_with_same_name_are_isolated(self):
        key_in_module_a: AttrKey[str] = AttrKey("config", str)
        key_in_module_b: AttrKey[str] = AttrKey("config", str)
        attrs = AttrMap()

        attrs.set(key_in_module_a, "value_a")
        attrs.set(key_in_module_b, "value_b")

        assert attrs.get(key_in_module_a) == "value_a"
        assert attrs.get(key_in_module_b) == "value_b"

    def test_multiple_attr_maps_are_independent(self):
        key: AttrKey[str] = AttrKey("session", str)
        attrs1 = AttrMap()
        attrs2 = AttrMap()

        attrs1.set(key, "map1")
        attrs2.set(key, "map2")

        assert attrs1.get(key) == "map1"
        assert attrs2.get(key) == "map2"
