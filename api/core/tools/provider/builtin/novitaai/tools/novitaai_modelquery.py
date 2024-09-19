import json
from copy import deepcopy
from typing import Any, Union

from pandas import DataFrame
from yarl import URL

from core.helper import ssrf_proxy
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class NovitaAiModelQueryTool(BuiltinTool):
    _model_query_endpoint = "https://api.novita.ai/v3/model"

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        if "api_key" not in self.runtime.credentials or not self.runtime.credentials.get("api_key"):
            raise ToolProviderCredentialValidationError("Novita AI API Key is required.")

        api_key = self.runtime.credentials.get("api_key")
        headers = {"Content-Type": "application/json", "Authorization": "Bearer " + api_key}
        params = self._process_parameters(tool_parameters)
        result_type = params.get("result_type")
        del params["result_type"]

        models_data = self._query_models(
            models_data=[],
            headers=headers,
            params=params,
            recursive=result_type not in {"first sd_name", "first name sd_name pair"},
        )

        result_str = ""
        if result_type == "first sd_name":
            result_str = models_data[0]["sd_name_in_api"] if len(models_data) > 0 else ""
        elif result_type == "first name sd_name pair":
            result_str = (
                json.dumps({"name": models_data[0]["name"], "sd_name": models_data[0]["sd_name_in_api"]})
                if len(models_data) > 0
                else ""
            )
        elif result_type == "sd_name array":
            sd_name_array = [model["sd_name_in_api"] for model in models_data] if len(models_data) > 0 else []
            result_str = json.dumps(sd_name_array)
        elif result_type == "name array":
            name_array = [model["name"] for model in models_data] if len(models_data) > 0 else []
            result_str = json.dumps(name_array)
        elif result_type == "name sd_name pair array":
            name_sd_name_pair_array = (
                [{"name": model["name"], "sd_name": model["sd_name_in_api"]} for model in models_data]
                if len(models_data) > 0
                else []
            )
            result_str = json.dumps(name_sd_name_pair_array)
        elif result_type == "whole info array":
            result_str = json.dumps(models_data)
        else:
            raise NotImplementedError

        return self.create_text_message(result_str)

    def _query_models(
        self,
        models_data: list,
        headers: dict[str, Any],
        params: dict[str, Any],
        pagination_cursor: str = "",
        recursive: bool = True,
    ) -> list:
        """
        query models
        """
        inside_params = deepcopy(params)

        if pagination_cursor != "":
            inside_params["pagination.cursor"] = pagination_cursor

        response = ssrf_proxy.get(
            url=str(URL(self._model_query_endpoint)), headers=headers, params=params, timeout=(10, 60)
        )

        res_data = response.json()

        models_data.extend(res_data["models"])

        res_data_len = len(res_data["models"])
        if res_data_len == 0 or res_data_len < int(params["pagination.limit"]) or recursive is False:
            # deduplicate
            df = DataFrame.from_dict(models_data)
            df_unique = df.drop_duplicates(subset=["id"])
            models_data = df_unique.to_dict("records")
            return models_data

        return self._query_models(
            models_data=models_data,
            headers=headers,
            params=inside_params,
            pagination_cursor=res_data["pagination"]["next_cursor"],
        )

    def _process_parameters(self, parameters: dict[str, Any]) -> dict[str, Any]:
        """
        process parameters
        """
        process_parameters = deepcopy(parameters)
        res_parameters = {}

        # delete none or empty
        keys_to_delete = [k for k, v in process_parameters.items() if v is None or v == ""]
        for k in keys_to_delete:
            del process_parameters[k]

        if "query" in process_parameters and process_parameters.get("query") != "unspecified":
            res_parameters["filter.query"] = process_parameters["query"]

        if "visibility" in process_parameters and process_parameters.get("visibility") != "unspecified":
            res_parameters["filter.visibility"] = process_parameters["visibility"]

        if "source" in process_parameters and process_parameters.get("source") != "unspecified":
            res_parameters["filter.source"] = process_parameters["source"]

        if "type" in process_parameters and process_parameters.get("type") != "unspecified":
            res_parameters["filter.types"] = process_parameters["type"]

        if "is_sdxl" in process_parameters:
            if process_parameters["is_sdxl"] == "true":
                res_parameters["filter.is_sdxl"] = True
            elif process_parameters["is_sdxl"] == "false":
                res_parameters["filter.is_sdxl"] = False

        res_parameters["result_type"] = process_parameters.get("result_type", "first sd_name")

        res_parameters["pagination.limit"] = (
            1
            if res_parameters.get("result_type") == "first sd_name"
            or res_parameters.get("result_type") == "first name sd_name pair"
            else 100
        )

        return res_parameters
