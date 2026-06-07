from controllers.openapi._models import MessageMetadata, UsageInfo


def test_usage_info_defaults_zero():
    u = UsageInfo()
    assert u.prompt_tokens == 0
    assert u.completion_tokens == 0
    assert u.total_tokens == 0


def test_message_metadata_accepts_partial():
    m = MessageMetadata(usage=UsageInfo(total_tokens=10))
    assert m.usage.total_tokens == 10
    assert m.retriever_resources == []


def test_describe_response_all_blocks_optional() -> None:
    from controllers.openapi._models import AppDescribeResponse

    payload = AppDescribeResponse().model_dump(mode="json", exclude_none=False)
    assert payload == {"info": None, "parameters": None, "input_schema": None}


def test_describe_response_input_schema_field() -> None:
    from controllers.openapi._models import AppDescribeResponse

    schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object"}
    payload = AppDescribeResponse(input_schema=schema).model_dump(mode="json", exclude_none=False)
    assert payload["input_schema"] == schema
    assert payload["info"] is None
    assert payload["parameters"] is None
