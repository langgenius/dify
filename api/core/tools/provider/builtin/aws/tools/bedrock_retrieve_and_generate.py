import json
from typing import Any

import boto3

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class BedrockRetrieveAndGenerateTool(BuiltinTool):
    bedrock_client: Any = None

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> ToolInvokeMessage:
        try:
            # Initialize Bedrock client if not already initialized
            if not self.bedrock_client:
                aws_region = tool_parameters.get("aws_region")
                aws_access_key_id = tool_parameters.get("aws_access_key_id")
                aws_secret_access_key = tool_parameters.get("aws_secret_access_key")

                client_kwargs = {"service_name": "bedrock-agent-runtime", "region_name": aws_region or None}

                # Only add credentials if both access key and secret key are provided
                if aws_access_key_id and aws_secret_access_key:
                    client_kwargs.update(
                        {"aws_access_key_id": aws_access_key_id, "aws_secret_access_key": aws_secret_access_key}
                    )

                self.bedrock_client = boto3.client(**client_kwargs)
        except Exception as e:
            return self.create_text_message(f"Failed to initialize Bedrock client: {str(e)}")

        try:
            request_config = {}

            # Set input configuration
            input_text = tool_parameters.get("input")
            if input_text:
                request_config["input"] = {"text": input_text}

            # Build retrieve and generate configuration
            config_type = tool_parameters.get("type")
            retrieve_generate_config = {"type": config_type}

            # Add configuration based on type
            if config_type == "KNOWLEDGE_BASE":
                kb_config_str = tool_parameters.get("knowledge_base_configuration")
                kb_config = json.loads(kb_config_str) if kb_config_str else None
                retrieve_generate_config["knowledgeBaseConfiguration"] = kb_config
            else:  # EXTERNAL_SOURCES
                es_config_str = tool_parameters.get("external_sources_configuration")
                es_config = json.loads(kb_config_str) if es_config_str else None
                retrieve_generate_config["externalSourcesConfiguration"] = es_config

            request_config["retrieveAndGenerateConfiguration"] = retrieve_generate_config

            # Parse session configuration
            session_config_str = tool_parameters.get("session_configuration")
            session_config = json.loads(session_config_str) if session_config_str else None
            if session_config:
                request_config["sessionConfiguration"] = session_config

            # Add session ID if provided
            session_id = tool_parameters.get("session_id")
            if session_id:
                request_config["sessionId"] = session_id

            # Send request
            response = self.bedrock_client.retrieve_and_generate(**request_config)

            # Process response
            result = {"output": response.get("output", {}).get("text", ""), "citations": []}

            # Process citations
            for citation in response.get("citations", []):
                citation_info = {
                    "text": citation.get("generatedResponsePart", {}).get("textResponsePart", {}).get("text", ""),
                    "references": [],
                }

                for ref in citation.get("retrievedReferences", []):
                    reference = {
                        "content": ref.get("content", {}).get("text", ""),
                        "metadata": ref.get("metadata", {}),
                        "location": None,
                    }

                    location = ref.get("location", {})
                    if location.get("type") == "S3":
                        reference["location"] = location.get("s3Location", {}).get("uri")

                    citation_info["references"].append(reference)

                result["citations"].append(citation_info)
            result_type = tool_parameters.get("result_type")
            if result_type == "json":
                return self.create_json_message(result)
            elif result_type == "text-with-citations":
                return self.create_text_message(result)
            else:
                return self.create_text_message(result.get("output"))
        except json.JSONDecodeError as e:
            return self.create_text_message(f"Invalid JSON format: {str(e)}")
        except Exception as e:
            return self.create_text_message(f"Tool invocation error: {str(e)}")

    def validate_parameters(self, parameters: dict[str, Any]) -> None:
        """Validate the parameters"""
        # Validate required parameters
        if not parameters.get("input"):
            raise ValueError("input is required")
        if not parameters.get("type"):
            raise ValueError("type is required")

        # Validate JSON configurations
        json_configs = ["knowledge_base_configuration", "external_sources_configuration", "session_configuration"]
        for config in json_configs:
            if config_value := parameters.get(config):
                try:
                    json.loads(config_value)
                except json.JSONDecodeError:
                    raise ValueError(f"{config} must be a valid JSON string")

        # Validate configuration type
        config_type = parameters.get("type")
        if config_type not in ["KNOWLEDGE_BASE", "EXTERNAL_SOURCES"]:
            raise ValueError("type must be either KNOWLEDGE_BASE or EXTERNAL_SOURCES")

        # Validate type-specific configuration
        if config_type == "KNOWLEDGE_BASE" and not parameters.get("knowledge_base_configuration"):
            raise ValueError("knowledge_base_configuration is required when type is KNOWLEDGE_BASE")
        elif config_type == "EXTERNAL_SOURCES" and not parameters.get("external_sources_configuration"):
            raise ValueError("external_sources_configuration is required when type is EXTERNAL_SOURCES")
