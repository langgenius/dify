from typing import Any, Optional

import orjson


def orjson_dumps(
    obj: Any,
    encoding: str = "utf-8",
    option: Optional[int] = None,
) -> str:
    return orjson.dumps(obj, option=option).decode(encoding)
