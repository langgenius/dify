import io
from typing import Any, Union

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential

from core.file.file_manager import download
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class ExtractDocumentTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        # Ensure runtime and credentials
        if not self.runtime or not self.runtime.credentials:
            raise ToolProviderCredentialValidationError("Tool runtime or credentials are missing")

        # Get endpoint and api key
        endpoint = str(self.runtime.credentials.get("azure_ai_document_intelligence_api_endpoint"))
        api_key = str(self.runtime.credentials.get("azure_ai_document_intelligence_api_key"))

        # Create credential
        credential = AzureKeyCredential(api_key)

        # Get file
        file = tool_parameters.get("file")
        file_binary = io.BytesIO(download(file))

        # Get output format
        output_format = tool_parameters.get("output_format")

        # Create client and analyze document
        document_analysis_client = DocumentIntelligenceClient(endpoint, credential)
        poller = document_analysis_client.begin_analyze_document(
            "prebuilt-layout",
            analyze_request=file_binary,
            content_type="application/octet-stream",
            output_content_format="markdown" if output_format == "markdown" else None,
        )
        result = poller.result()

        # Return result
        return [self.create_text_message(result.content)]
