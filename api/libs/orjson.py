from typing import Any

import orjson


def orjson_dumps(
    obj: Any,
    encoding: str = "utf-8",
    option: int = None,
) -> str:
    return orjson.dumps(obj, option=option).decode(encoding)
