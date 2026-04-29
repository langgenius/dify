from typing import TypeGuard


def is_str_dict(v: object) -> TypeGuard[dict[str, object]]:
    return isinstance(v, dict)


def is_str(v: object) -> TypeGuard[str]:
    return isinstance(v, str)
