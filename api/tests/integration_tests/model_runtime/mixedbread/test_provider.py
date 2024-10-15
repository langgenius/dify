import os
from unittest.mock import Mock, patch

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.mixedbread.mixedbread import MixedBreadProvider


def test_validate_provider_credentials():
    provider = MixedBreadProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={"api_key": "hahahaha"})
    with patch("requests.post") as mock_post:
        mock_response = Mock()
        mock_response.json.return_value = {
            "usage": {"prompt_tokens": 3, "total_tokens": 3},
            "model": "mixedbread-ai/mxbai-embed-large-v1",
            "data": [{"embedding": [0.23333 for _ in range(1024)], "index": 0, "object": "embedding"}],
            "object": "list",
            "normalized": "true",
            "encoding_format": "float",
            "dimensions": 1024,
        }
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        provider.validate_provider_credentials(credentials={"api_key": os.environ.get("MIXEDBREAD_API_KEY")})
