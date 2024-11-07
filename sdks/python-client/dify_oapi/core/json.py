import copy
import datetime
import io
from json import JSONEncoder, dumps, loads
from typing import Any

from .const import UTF_8
from .type import T


class JSON:
    @staticmethod
    def marshal(obj: Any, indent=None) -> str | None:
        if obj is None:
            return None
        return dumps(obj, cls=Encoder, indent=indent, ensure_ascii=False)

    @staticmethod
    def unmarshal(json_str: str, clazz: type[T]) -> T:
        dict_obj = loads(json_str)
        return clazz(**dict_obj)


class Encoder(JSONEncoder):
    def default(self, o: Any) -> Any:
        if isinstance(o, io.BufferedReader):
            return o.__str__()
        if hasattr(o, "__dict__"):
            return filter_null(copy.deepcopy(vars(o)))
        if isinstance(o, datetime.datetime):
            return o.strftime("%Y-%m-%d %H:%M:%S")
        if isinstance(o, bytes):
            return str(o, encoding=UTF_8)
        if isinstance(o, int):
            return int(o)
        if isinstance(o, float):
            return float(o)
        if isinstance(o, set):
            return list(o)


def filter_null(d: dict) -> dict:
    if isinstance(d, dict):
        for k, v in list(d.items()):
            if isinstance(v, dict):
                filter_null(v)
            elif v is None:
                del d[k]

    return d
