from controllers.openapi._models import AppDescribeResponse


def test_describe_response_all_blocks_optional() -> None:
    payload = AppDescribeResponse().model_dump(mode="json", exclude_none=False)
    assert payload == {"info": None, "parameters": None, "input_schema": None}
