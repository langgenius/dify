import orjson

from libs.orjson import orjson_dumps


def test_orjson_dumps_round_trip_basic():
    obj = {"a": 1, "b": [1, 2, 3], "c": {"d": True}}
    s = orjson_dumps(obj)
    assert orjson.loads(s) == obj


def test_orjson_dumps_with_unicode_and_indent():
    obj = {"msg": "你好，Dify"}
    s = orjson_dumps(obj, option=orjson.OPT_INDENT_2)
    # contains indentation newline/spaces
    assert "\n" in s
    assert orjson.loads(s) == obj
