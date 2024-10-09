import os
from unittest.mock import Mock, patch

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.voyage.voyage import VoyageProvider


def test_validate_provider_credentials():
    provider = VoyageProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={"api_key": "hahahaha"})
    with patch("requests.post") as mock_post:
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "data": [{"object": "embedding", "embedding": [0.23333 for _ in range(1024)], "index": 0}],
            "model": "voyage-3",
            "usage": {"total_tokens": 1},
        }
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        provider.validate_provider_credentials(credentials={"api_key": os.environ.get("VOYAGE_API_KEY")})
