import random
from unittest.mock import MagicMock, patch

from core.helper.ssrf_proxy import SSRF_DEFAULT_MAX_RETRIES, STATUS_FORCELIST, make_request


@patch('httpx.request')
def test_successful_request(mock_request):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_request.return_value = mock_response

    response = make_request('GET', 'http://example.com')
    assert response.status_code == 200


@patch('httpx.request')
def test_retry_exceed_max_retries(mock_request):
    mock_response = MagicMock()
    mock_response.status_code = 500

    side_effects = [mock_response] * SSRF_DEFAULT_MAX_RETRIES
    mock_request.side_effect = side_effects

    try:
        make_request('GET', 'http://example.com', max_retries=SSRF_DEFAULT_MAX_RETRIES - 1)
        raise AssertionError("Expected Exception not raised")
    except Exception as e:
        assert str(e) == f"Reached maximum retries ({SSRF_DEFAULT_MAX_RETRIES - 1}) for URL http://example.com"


@patch('httpx.request')
def test_retry_logic_success(mock_request):
    side_effects = []

    for _ in range(SSRF_DEFAULT_MAX_RETRIES):
        status_code = random.choice(STATUS_FORCELIST)
        mock_response = MagicMock()
        mock_response.status_code = status_code
        side_effects.append(mock_response)

    mock_response_200 = MagicMock()
    mock_response_200.status_code = 200
    side_effects.append(mock_response_200)

    mock_request.side_effect = side_effects

    response = make_request('GET', 'http://example.com', max_retries=SSRF_DEFAULT_MAX_RETRIES)

    assert response.status_code == 200
    assert mock_request.call_count == SSRF_DEFAULT_MAX_RETRIES + 1
    assert mock_request.call_args_list[0][1].get('method') == 'GET'
