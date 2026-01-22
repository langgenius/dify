"""
Type-safe attribute storage inspired by Netty's AttributeKey/AttributeMap pattern.

Provides loosely-coupled typed attribute storage where only code with access
to the same AttrKey instance can read/write the corresponding attribute.

    SESSION_KEY: AttrKey[Session] = AttrKey("session", Session)
    attrs = AttrMap()
    attrs.set(SESSION_KEY, session)
    session = attrs.get(SESSION_KEY)  # -> Session (raises if not set)
    session = attrs.get_or_none(SESSION_KEY)  # -> Session | None

Note: AttrMap is NOT thread-safe. Each instance should be confined to a single
thread/context (e.g., one AttrMap per Sandbox/VirtualEnvironment instance).
"""

from __future__ import annotations

from typing import Any, Generic, TypeVar, cast, final, overload

T = TypeVar("T")
D = TypeVar("D")


@final
class AttrKey(Generic[T]):
    """
    A type-safe key for attribute storage.

    Identity-based: different AttrKey instances with same name are distinct keys.
    This enables different modules to define keys independently without collision.
    """

    __slots__ = ("_name", "_type")

    def __init__(self, name: str, type_: type[T]) -> None:
        self._name = name
        self._type = type_

    @property
    def name(self) -> str:
        return self._name

    @property
    def type_(self) -> type[T]:
        return self._type

    def __repr__(self) -> str:
        return f"AttrKey({self._name!r}, {self._type.__name__})"

    def __hash__(self) -> int:
        return id(self)

    def __eq__(self, other: object) -> bool:
        return self is other


class AttrMapKeyError(KeyError):
    """Raised when a required attribute is not set."""

    key: AttrKey[Any]

    def __init__(self, key: AttrKey[Any]) -> None:
        self.key = key
        super().__init__(f"Required attribute '{key.name}' (type: {key.type_.__name__}) is not set")


class AttrMapTypeError(TypeError):
    """Raised when attribute value type doesn't match the key's declared type."""

    key: AttrKey[Any]
    expected_type: type[Any]
    actual_type: type[Any]

    def __init__(self, key: AttrKey[Any], expected_type: type[Any], actual_type: type[Any]) -> None:
        self.key = key
        self.expected_type = expected_type
        self.actual_type = actual_type
        super().__init__(
            f"Attribute '{key.name}' expects type '{expected_type.__name__}', "
            f"got '{actual_type.__name__}'"
        )


@final
class AttrMap:
    """
    Thread-confined container for storing typed attributes using AttrKey instances.

    NOT thread-safe. Each instance should be owned by a single context
    (e.g., one AttrMap per Sandbox/VirtualEnvironment instance).
    """

    __slots__ = ("_data",)

    def __init__(self) -> None:
        self._data: dict[AttrKey[Any], Any] = {}

    def set(self, key: AttrKey[T], value: T, *, validate: bool = True) -> None:
        """
        Store an attribute. Raises AttrMapTypeError if validate=True and type mismatches.

        Note: Runtime validation only checks outer type (e.g., `list` not `list[str]`).
        """
        if validate and not isinstance(value, key.type_):
            raise AttrMapTypeError(key, key.type_, type(value))
        self._data[key] = value

    def get(self, key: AttrKey[T]) -> T:
        """Retrieve an attribute. Raises AttrMapKeyError if not set."""
        if key not in self._data:
            raise AttrMapKeyError(key)
        return cast(T, self._data[key])

    def get_or_none(self, key: AttrKey[T]) -> T | None:
        """Retrieve an attribute, returning None if not set."""
        return cast(T | None, self._data.get(key))

    @overload
    def get_or_default(self, key: AttrKey[T], default: T) -> T: ...

    @overload
    def get_or_default(self, key: AttrKey[T], default: D) -> T | D: ...

    def get_or_default(self, key: AttrKey[T], default: T | D) -> T | D:
        """Retrieve an attribute, returning default if not set."""
        if key in self._data:
            return cast(T, self._data[key])
        return default

    def has(self, key: AttrKey[Any]) -> bool:
        """Check if an attribute is set."""
        return key in self._data

    def remove(self, key: AttrKey[Any]) -> bool:
        """Remove an attribute. Returns True if it was present."""
        if key in self._data:
            del self._data[key]
            return True
        return False

    def set_if_absent(self, key: AttrKey[T], value: T, *, validate: bool = True) -> T:
        """
        Set attribute only if not already set. Returns existing or newly set value.

        Raises AttrMapTypeError if validate=True and type mismatches.
        """
        if key in self._data:
            return cast(T, self._data[key])
        if validate and not isinstance(value, key.type_):
            raise AttrMapTypeError(key, key.type_, type(value))
        self._data[key] = value
        return value

    def clear(self) -> None:
        """Remove all attributes."""
        self._data.clear()

    def __len__(self) -> int:
        return len(self._data)

    def __repr__(self) -> str:
        keys = [k.name for k in self._data]
        return f"AttrMap({keys})"
