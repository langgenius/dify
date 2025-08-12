from collections.abc import Generator
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from configs import dify_config
from core.plugin.entities.plugin import GenericProviderID, ToolProviderID
from core.plugin.entities.plugin_daemon import PluginBasicBooleanResponse, PluginToolProviderEntity
from core.plugin.impl.base import BasePluginClient
from core.tools.entities.tool_entities import CredentialType, ToolInvokeMessage, ToolParameter


class FileChunk(BaseModel):
    """File chunk buffer for assembling blob data from chunks."""

    bytes_written: int = 0
    total_length: int
    data: bytearray = Field(default_factory=bytearray)

    def __iadd__(self, other: bytes) -> "FileChunk":
        self.data[self.bytes_written : self.bytes_written + len(other)] = other
        self.bytes_written += len(other)
        if self.bytes_written > self.total_length:
            raise ValueError(f"File chunk is too large which reached the limit of {self.total_length} bytes")
        return self

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @field_validator("total_length")
    @classmethod
    def validate_total_length(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("total_length must be positive")
        if v > dify_config.TOOL_FILE_MAX_SIZE:
            raise ValueError(f"total_length exceeds maximum file size of {dify_config.TOOL_FILE_MAX_SIZE} bytes")
        return v

    @model_validator(mode="before")
    @classmethod
    def initialize_data_buffer(cls, values):
        if isinstance(values, dict):
            if "data" not in values or values["data"] is None:
                if "total_length" in values:
                    values["data"] = bytearray(values["total_length"])
        return values


class PluginToolManager(BasePluginClient):
    def fetch_tool_providers(self, tenant_id: str) -> list[PluginToolProviderEntity]:
        """
        Fetch tool providers for the given tenant.
        """

        def transformer(json_response: dict[str, Any]) -> dict:
            for provider in json_response.get("data", []):
                declaration = provider.get("declaration", {}) or {}
                provider_name = declaration.get("identity", {}).get("name")
                for tool in declaration.get("tools", []):
                    tool["identity"]["provider"] = provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/tools",
            list[PluginToolProviderEntity],
            params={"page": 1, "page_size": 256},
            transformer=transformer,
        )

        for provider in response:
            provider.declaration.identity.name = f"{provider.plugin_id}/{provider.declaration.identity.name}"

            # override the provider name for each tool to plugin_id/provider_name
            for tool in provider.declaration.tools:
                tool.identity.provider = provider.declaration.identity.name

        return response

    def _process_blob_chunks(
        self,
        response: Generator[ToolInvokeMessage, None, None],
        chunk_size_limit: int = 8192,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Process blob chunks from tool invocation responses.

        Args:
            response: Generator yielding ToolInvokeMessage instances
            chunk_size_limit: Maximum size for a single chunk (default 8KB)

        Yields:
            ToolInvokeMessage: Processed messages with complete blobs assembled from chunks

        Raises:
            ValueError: If chunk or file size limits are exceeded
        """
        chunks: dict[str, FileChunk] = {}

        for resp in response:
            if resp.type != ToolInvokeMessage.MessageType.BLOB_CHUNK:
                yield resp
                continue

            assert isinstance(resp.message, ToolInvokeMessage.BlobChunkMessage)

            # Get blob chunk information
            chunk_id = resp.message.id
            total_length = resp.message.total_length
            blob_data = resp.message.blob
            is_end = resp.message.end

            # Initialize buffer for this file if it doesn't exist
            if chunk_id not in chunks:
                if total_length > dify_config.TOOL_FILE_MAX_SIZE:
                    raise ValueError(
                        f"File is too large which reached the limit of {dify_config.TOOL_FILE_MAX_SIZE} bytes"
                    )
                chunks[chunk_id] = FileChunk(total_length=total_length)

            # Append the blob data to the buffer
            chunks[chunk_id] += blob_data

            # If this is the final chunk, yield a complete blob message
            if is_end:
                yield ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.BLOB,
                    message=ToolInvokeMessage.BlobMessage(blob=chunks[chunk_id].data),
                    meta=resp.meta,
                )
                del chunks[chunk_id]

    def fetch_tool_provider(self, tenant_id: str, provider: str) -> PluginToolProviderEntity:
        """
        Fetch tool provider for the given tenant and plugin.
        """
        tool_provider_id = ToolProviderID(provider)

        def transformer(json_response: dict[str, Any]) -> dict:
            data = json_response.get("data")
            if data:
                for tool in data.get("declaration", {}).get("tools", []):
                    tool["identity"]["provider"] = tool_provider_id.provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/tool",
            PluginToolProviderEntity,
            params={"provider": tool_provider_id.provider_name, "plugin_id": tool_provider_id.plugin_id},
            transformer=transformer,
        )

        response.declaration.identity.name = f"{response.plugin_id}/{response.declaration.identity.name}"

        # override the provider name for each tool to plugin_id/provider_name
        for tool in response.declaration.tools:
            tool.identity.provider = response.declaration.identity.name

        return response

    def invoke(
        self,
        tenant_id: str,
        user_id: str,
        tool_provider: str,
        tool_name: str,
        credentials: dict[str, Any],
        credential_type: CredentialType,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Invoke the tool with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        tool_provider_id = GenericProviderID(tool_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/tool/invoke",
            ToolInvokeMessage,
            data={
                "user_id": user_id,
                "conversation_id": conversation_id,
                "app_id": app_id,
                "message_id": message_id,
                "data": {
                    "provider": tool_provider_id.provider_name,
                    "tool": tool_name,
                    "credentials": credentials,
                    "credential_type": credential_type,
                    "tool_parameters": tool_parameters,
                },
            },
            headers={
                "X-Plugin-ID": tool_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        # Process blob chunks using the handler method
        return self._process_blob_chunks(response)

    def validate_provider_credentials(
        self, tenant_id: str, user_id: str, provider: str, credentials: dict[str, Any]
    ) -> bool:
        """
        validate the credentials of the provider
        """
        tool_provider_id = GenericProviderID(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/tool/validate_credentials",
            PluginBasicBooleanResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": tool_provider_id.provider_name,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": tool_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.result

        return False

    def get_runtime_parameters(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        credentials: dict[str, Any],
        tool: str,
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> list[ToolParameter]:
        """
        get the runtime parameters of the tool
        """
        tool_provider_id = GenericProviderID(provider)

        class RuntimeParametersResponse(BaseModel):
            parameters: list[ToolParameter]

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/tool/get_runtime_parameters",
            RuntimeParametersResponse,
            data={
                "user_id": user_id,
                "conversation_id": conversation_id,
                "app_id": app_id,
                "message_id": message_id,
                "data": {
                    "provider": tool_provider_id.provider_name,
                    "tool": tool,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": tool_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.parameters

        return []
