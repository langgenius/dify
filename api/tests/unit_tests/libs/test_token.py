from constants import COOKIE_NAME_ACCESS_TOKEN
from libs.token import extract_access_token


class MockRequest:
    def __init__(self, headers: dict[str, str], cookies: dict[str, str], args: dict[str, str]):
        self.headers: dict[str, str] = headers
        self.cookies: dict[str, str] = cookies
        self.args: dict[str, str] = args


def test_extract_access_token():
    def _mock_request(headers: dict[str, str], cookies: dict[str, str], args: dict[str, str]):
        return MockRequest(headers, cookies, args)

    test_cases = [
        (_mock_request({"Authorization": "Bearer 123"}, {}, {}), "123"),
        (_mock_request({}, {COOKIE_NAME_ACCESS_TOKEN: "123"}, {}), "123"),
        (_mock_request({}, {}, {}), None),
        (_mock_request({"Authorization": "Bearer_aaa 123"}, {}, {}), None),
    ]
    for request, expected in test_cases:
        assert extract_access_token(request) == expected  # pyright: ignore[reportArgumentType]
