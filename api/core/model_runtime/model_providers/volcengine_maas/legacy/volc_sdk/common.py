import json
import random
from datetime import datetime


class ChatRole:
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    FUNCTION = "function"


class _Dict(dict):
    __setattr__ = dict.__setitem__
    __getattr__ = dict.__getitem__

    def __missing__(self, key):
        return None


def dict_to_object(dict_obj):
    # 支持嵌套类型
    if isinstance(dict_obj, list):
        insts = []
        for i in dict_obj:
            insts.append(dict_to_object(i))
        return insts

    if isinstance(dict_obj, dict):
        inst = _Dict()
        for k, v in dict_obj.items():
            inst[k] = dict_to_object(v)
        return inst

    return dict_obj


def json_to_object(json_str, req_id=None):
    obj = dict_to_object(json.loads(json_str))
    if obj and isinstance(obj, dict) and req_id:
        obj["req_id"] = req_id
    return obj


def gen_req_id():
    return datetime.now().strftime("%Y%m%d%H%M%S") + format(
        random.randint(0, 2 ** 64 - 1), "020X"
    )


class SSEDecoder:
    def __init__(self, source):
        self.source = source

    def _read(self):
        data = b''
        for chunk in self.source:
            for line in chunk.splitlines(True):
                data += line
                if data.endswith((b'\r\r', b'\n\n', b'\r\n\r\n')):
                    yield data
                    data = b''
        if data:
            yield data

    def next(self):
        for chunk in self._read():
            for line in chunk.splitlines():
                # skip comment
                if line.startswith(b':'):
                    continue

                if b':' in line:
                    field, value = line.split(b':', 1)
                else:
                    field, value = line, b''

                if field == b'data' and len(value) > 0:
                    yield value
