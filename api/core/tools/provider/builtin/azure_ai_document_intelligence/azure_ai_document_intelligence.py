from typing import Any

import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AzureAIDocumentIntelligenceProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        api_key = credentials.get("azure_ai_document_intelligence_api_key")
        api_endpoint = credentials.get("azure_ai_document_intelligence_api_endpoint")

        # Ensure API key and endpoint are provided
        if not api_key:
            raise ToolProviderCredentialValidationError("Azure AI Document Intelligence API key is missing")
        if not api_endpoint:
            raise ToolProviderCredentialValidationError("Azure AI Document Intelligence API endpoint is missing")

        # Validate the API key and endpoint
        headers = {"Ocp-Apim-Subscription-Key": api_key}
        url = (
            f"{api_endpoint}/documentintelligence/documentModels/"
            f"prebuilt-layout/analyzeResults/00000000-0000-0000-0000-000000000000"
            f"?api-version=2024-07-31-preview"
        )

        # Check if the API key and endpoint are valid
        try:
            response = requests.get(url, headers=headers)
            json_response = response.json()
            if "error" in json_response:
                if json_response["error"]["code"] == "NotFound":
                    return
            raise ToolProviderCredentialValidationError("Azure AI Document Intelligence API key or endpoint is invalid")
        except:
            raise ToolProviderCredentialValidationError("Azure AI Document Intelligence API key or endpoint is invalid")
