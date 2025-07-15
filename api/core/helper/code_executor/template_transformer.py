import json
import re
from abc import ABC, abstractmethod
from base64 import b64encode
from collections.abc import Mapping
from typing import Any

from core.variables.utils import SegmentJSONEncoder


class TemplateTransformer(ABC):
    _code_placeholder: str = "{{code}}"
    _inputs_placeholder: str = "{{inputs}}"
    _result_tag: str = "<<RESULT>>"

    @classmethod
    def transform_caller(cls, code: str, inputs: Mapping[str, Any]) -> tuple[str, str]:
        """
        Transform code to python runner
        :param code: code
        :param inputs: inputs
        :return: runner, preload
        """
        runner_script = cls.assemble_runner_script(code, inputs)
        preload_script = cls.get_preload_script()

        return runner_script, preload_script

    @classmethod
    def extract_result_str_from_response(cls, response: str):
        result = re.search(rf"{cls._result_tag}(.*){cls._result_tag}", response, re.DOTALL)
        if not result:
            raise ValueError(f"Failed to parse result: no result tag found in response. Response: {response[:200]}...")
        return result.group(1)

    @classmethod
    def transform_response(cls, response: str) -> Mapping[str, Any]:
        """
        Transform response to dict
        :param response: response
        :return:
        """

        try:
            result_str = cls.extract_result_str_from_response(response)
            result = json.loads(result_str)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse JSON response: {str(e)}.")
        except ValueError as e:
            # Re-raise ValueError from extract_result_str_from_response
            raise e
        except Exception as e:
            raise ValueError(f"Unexpected error during response transformation: {str(e)}")

        if not isinstance(result, dict):
            raise ValueError(f"Result must be a dict, got {type(result).__name__}")
        if not all(isinstance(k, str) for k in result):
            raise ValueError("Result keys must be strings")

        # Post-process the result to convert scientific notation strings back to numbers
        result = cls._post_process_result(result)
        return result

    @classmethod
    def _post_process_result(cls, result: dict[Any, Any]) -> dict[Any, Any]:
        """
        Post-process the result to convert scientific notation strings back to numbers
        """

        def convert_scientific_notation(value):
            if isinstance(value, str):
                # Check if the string looks like scientific notation
                if re.match(r"^-?\d+\.?\d*e[+-]\d+$", value, re.IGNORECASE):
                    try:
                        return float(value)
                    except ValueError:
                        pass
            elif isinstance(value, dict):
                return {k: convert_scientific_notation(v) for k, v in value.items()}
            elif isinstance(value, list):
                return [convert_scientific_notation(v) for v in value]
            return value

        return convert_scientific_notation(result)  # type: ignore[no-any-return]

    @classmethod
    @abstractmethod
    def get_runner_script(cls) -> str:
        """
        Get runner script
        """
        pass

    @classmethod
    def serialize_inputs(cls, inputs: Mapping[str, Any]) -> str:
        inputs_json_str = json.dumps(inputs, ensure_ascii=False, cls=SegmentJSONEncoder).encode()
        input_base64_encoded = b64encode(inputs_json_str).decode("utf-8")
        return input_base64_encoded

    @classmethod
    def assemble_runner_script(cls, code: str, inputs: Mapping[str, Any]) -> str:
        # assemble runner script
        script = cls.get_runner_script()
        script = script.replace(cls._code_placeholder, code)
        inputs_str = cls.serialize_inputs(inputs)
        script = script.replace(cls._inputs_placeholder, inputs_str)
        return script

    @classmethod
    def get_preload_script(cls) -> str:
        """
        Get preload script
        """
        return ""
