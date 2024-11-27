from typing import Any
from urllib.parse import urlencode

import requests
from requests.auth import HTTPBasicAuth

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class FetchPromptTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        paramRequest = {}

        hostUrl = tool_parameters.get("hostUrl")
        publicKey = tool_parameters.get("publicKey")
        secretKey = tool_parameters.get("secretKey")
        page = tool_parameters.get("page")
        limit = tool_parameters.get("limit")
        datasetName = tool_parameters.get("datasetName")
        sourceTraceId = tool_parameters.get("sourceTraceId")
        sourceObservationId = tool_parameters.get("sourceObservationId")
        itemID = tool_parameters.get("itemID")

        if all([hostUrl, publicKey, secretKey]):
            print("ok")
        else:
            print("One or more parameters are missing or empty.")
            raise ToolProviderCredentialValidationError("One or more parameters are missing or empty.")

        if sourceObservationId != "":
            paramRequest["sourceObservationId"] = sourceObservationId
        if sourceTraceId != "":
            paramRequest["sourceTraceId"] = sourceTraceId
        if datasetName != "":
            paramRequest["datasetName"] = datasetName

        requestUrl = hostUrl + "/api/public/dataset-items"

        if itemID != "":
            requestUrl = f"{requestUrl}/{itemID}"
        else:
            if page > 0:
                paramRequest["page"] = page
            if limit > 0:
                paramRequest["limit"] = limit

        full_url = f"{requestUrl}?{urlencode(paramRequest)}"
        print(full_url)

        response = requests.get(requestUrl, params=paramRequest, auth=HTTPBasicAuth(publicKey, secretKey))

        if response.status_code == 200:
            print(response.text)
            return self.create_json_message(response.json())
        else:
            return self.create_text_message(f"API request failed with status code {response.status_code}")
