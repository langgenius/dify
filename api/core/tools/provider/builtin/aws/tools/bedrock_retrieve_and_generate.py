import json
from typing import Any, Optional

import boto3

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class BedrockRetrieveAndGenerateTool(BuiltinTool):
    bedrock_client: Any = None

    def _create_text_inference_config(
        self,
        max_tokens: Optional[int] = None,
        stop_sequences: Optional[str] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
    ) -> Optional[dict]:
        """Create text inference configuration"""
        if any([max_tokens, stop_sequences, temperature, top_p]):
            config = {}
            if max_tokens is not None:
                config["maxTokens"] = max_tokens
            if stop_sequences:
                try:
                    config["stopSequences"] = json.loads(stop_sequences)
                except json.JSONDecodeError:
                    config["stopSequences"] = []
            if temperature is not None:
                config["temperature"] = temperature
            if top_p is not None:
                config["topP"] = top_p
            return config
        return None

    def _create_guardrail_config(
        self,
        guardrail_id: Optional[str] = None,
        guardrail_version: Optional[str] = None,
    ) -> Optional[dict]:
        """Create guardrail configuration"""
        if guardrail_id and guardrail_version:
            return {"guardrailId": guardrail_id, "guardrailVersion": guardrail_version}
        return None

    def _create_generation_config(
        self,
        additional_model_fields: Optional[str] = None,
        guardrail_config: Optional[dict] = None,
        text_inference_config: Optional[dict] = None,
        performance_mode: Optional[str] = None,
        prompt_template: Optional[str] = None,
    ) -> dict:
        """Create generation configuration"""
        config = {}

        if additional_model_fields:
            try:
                config["additionalModelRequestFields"] = json.loads(additional_model_fields)
            except json.JSONDecodeError:
                pass

        if guardrail_config:
            config["guardrailConfiguration"] = guardrail_config

        if text_inference_config:
            config["inferenceConfig"] = {"textInferenceConfig": text_inference_config}

        if performance_mode:
            config["performanceConfig"] = {"latency": performance_mode}

        if prompt_template:
            config["promptTemplate"] = {"textPromptTemplate": prompt_template}

        return config

    def _create_orchestration_config(
        self,
        orchestration_additional_model_fields: Optional[str] = None,
        orchestration_text_inference_config: Optional[dict] = None,
        orchestration_performance_mode: Optional[str] = None,
        orchestration_prompt_template: Optional[str] = None,
    ) -> dict:
        """Create orchestration configuration"""
        config = {}

        if orchestration_additional_model_fields:
            try:
                config["additionalModelRequestFields"] = json.loads(orchestration_additional_model_fields)
            except json.JSONDecodeError:
                pass

        if orchestration_text_inference_config:
            config["inferenceConfig"] = {"textInferenceConfig": orchestration_text_inference_config}

        if orchestration_performance_mode:
            config["performanceConfig"] = {"latency": orchestration_performance_mode}

        if orchestration_prompt_template:
            config["promptTemplate"] = {"textPromptTemplate": orchestration_prompt_template}

        return config

    def _create_vector_search_config(
        self,
        number_of_results: int = 5,
        search_type: str = "SEMANTIC",
        metadata_filter: Optional[dict] = None,
    ) -> dict:
        """Create vector search configuration"""
        config = {
            "numberOfResults": number_of_results,
            "overrideSearchType": search_type,
        }

        # Only add filter if metadata_filter is not empty
        if metadata_filter:
            config["filter"] = metadata_filter

        return config

    def _bedrock_retrieve_and_generate(
        self,
        query: str,
        knowledge_base_id: str,
        model_arn: str,
        # Generation Configuration
        additional_model_fields: Optional[str] = None,
        guardrail_id: Optional[str] = None,
        guardrail_version: Optional[str] = None,
        max_tokens: Optional[int] = None,
        stop_sequences: Optional[str] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
        performance_mode: str = "standard",
        prompt_template: Optional[str] = None,
        # Orchestration Configuration
        orchestration_additional_model_fields: Optional[str] = None,
        orchestration_max_tokens: Optional[int] = None,
        orchestration_stop_sequences: Optional[str] = None,
        orchestration_temperature: Optional[float] = None,
        orchestration_top_p: Optional[float] = None,
        orchestration_performance_mode: Optional[str] = None,
        orchestration_prompt_template: Optional[str] = None,
        # Retrieval Configuration
        number_of_results: int = 5,
        search_type: str = "SEMANTIC",
        metadata_filter: Optional[dict] = None,
        # Additional Configuration
        session_id: Optional[str] = None,
    ) -> dict[str, Any]:
        try:
            # Create text inference configurations
            text_inference_config = self._create_text_inference_config(max_tokens, stop_sequences, temperature, top_p)
            orchestration_text_inference_config = self._create_text_inference_config(
                orchestration_max_tokens, orchestration_stop_sequences, orchestration_temperature, orchestration_top_p
            )

            # Create guardrail configuration
            guardrail_config = self._create_guardrail_config(guardrail_id, guardrail_version)

            # Create vector search configuration
            vector_search_config = self._create_vector_search_config(number_of_results, search_type, metadata_filter)

            # Create generation configuration
            generation_config = self._create_generation_config(
                additional_model_fields, guardrail_config, text_inference_config, performance_mode, prompt_template
            )

            # Create orchestration configuration
            orchestration_config = self._create_orchestration_config(
                orchestration_additional_model_fields,
                orchestration_text_inference_config,
                orchestration_performance_mode,
                orchestration_prompt_template,
            )

            # Create knowledge base configuration
            knowledge_base_config = {
                "knowledgeBaseId": knowledge_base_id,
                "modelArn": model_arn,
                "generationConfiguration": generation_config,
                "orchestrationConfiguration": orchestration_config,
                "retrievalConfiguration": {"vectorSearchConfiguration": vector_search_config},
            }

            # Create request configuration
            request_config = {
                "input": {"text": query},
                "retrieveAndGenerateConfiguration": {
                    "type": "KNOWLEDGE_BASE",
                    "knowledgeBaseConfiguration": knowledge_base_config,
                },
            }

            # Add session configuration if provided
            if session_id and len(session_id) >= 2:
                request_config["sessionConfiguration"] = {"sessionId": session_id}
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

            return result

        except Exception as e:
            raise Exception(f"Error calling Bedrock service: {str(e)}")

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

                client_kwargs = {
                    "service_name": "bedrock-agent-runtime",
                }
                if aws_region:
                    client_kwargs["region_name"] = aws_region
                # Only add credentials if both access key and secret key are provided
                if aws_access_key_id and aws_secret_access_key:
                    client_kwargs.update(
                        {"aws_access_key_id": aws_access_key_id, "aws_secret_access_key": aws_secret_access_key}
                    )

                try:
                    self.bedrock_client = boto3.client(**client_kwargs)
                except Exception as e:
                    return self.create_text_message(f"Failed to initialize Bedrock client: {str(e)}")

            # Parse metadata filter if provided
            metadata_filter = None
            if metadata_filter_str := tool_parameters.get("metadata_filter"):
                try:
                    parsed_filter = json.loads(metadata_filter_str)
                    if parsed_filter:  # Only set if not empty
                        metadata_filter = parsed_filter
                except json.JSONDecodeError:
                    return self.create_text_message("metadata_filter must be a valid JSON string")

            try:
                response = self._bedrock_retrieve_and_generate(
                    query=tool_parameters["query"],
                    knowledge_base_id=tool_parameters["knowledge_base_id"],
                    model_arn=tool_parameters["model_arn"],
                    # Generation Configuration
                    additional_model_fields=tool_parameters.get("additional_model_fields"),
                    guardrail_id=tool_parameters.get("guardrail_id"),
                    guardrail_version=tool_parameters.get("guardrail_version"),
                    max_tokens=tool_parameters.get("max_tokens"),
                    stop_sequences=tool_parameters.get("stop_sequences"),
                    temperature=tool_parameters.get("temperature"),
                    top_p=tool_parameters.get("top_p"),
                    performance_mode=tool_parameters.get("performance_mode", "standard"),
                    prompt_template=tool_parameters.get("prompt_template"),
                    # Orchestration Configuration
                    orchestration_additional_model_fields=tool_parameters.get("orchestration_additional_model_fields"),
                    orchestration_max_tokens=tool_parameters.get("orchestration_max_tokens"),
                    orchestration_stop_sequences=tool_parameters.get("orchestration_stop_sequences"),
                    orchestration_temperature=tool_parameters.get("orchestration_temperature"),
                    orchestration_top_p=tool_parameters.get("orchestration_top_p"),
                    orchestration_performance_mode=tool_parameters.get("orchestration_performance_mode"),
                    orchestration_prompt_template=tool_parameters.get("orchestration_prompt_template"),
                    # Retrieval Configuration
                    number_of_results=tool_parameters.get("number_of_results", 5),
                    search_type=tool_parameters.get("search_type", "SEMANTIC"),
                    metadata_filter=metadata_filter,
                    # Additional Configuration
                    session_id=tool_parameters.get("session_id"),
                )
                return self.create_json_message(response)

            except Exception as e:
                return self.create_text_message(f"Tool invocation error: {str(e)}")

        except Exception as e:
            return self.create_text_message(f"Tool execution error: {str(e)}")

    def validate_parameters(self, parameters: dict[str, Any]) -> None:
        """Validate the parameters"""
        required_params = ["query", "model_arn", "knowledge_base_id"]
        for param in required_params:
            if not parameters.get(param):
                raise ValueError(f"{param} is required")

        # Validate metadata filter if provided
        if metadata_filter_str := parameters.get("metadata_filter"):
            try:
                if not isinstance(json.loads(metadata_filter_str), dict):
                    raise ValueError("metadata_filter must be a valid JSON object")
            except json.JSONDecodeError:
                raise ValueError("metadata_filter must be a valid JSON string")
