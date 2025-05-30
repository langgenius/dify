from collections.abc import Generator
from typing import Any, Optional

from pydantic import BaseModel

from configs import dify_config
from core.plugin.entities.plugin import GenericProviderID, ToolProviderID
from core.plugin.entities.plugin_daemon import PluginBasicBooleanResponse, PluginToolProviderEntity
from core.plugin.impl.base import BasePluginClient
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter


class FileChunk:
    """
    Only used for internal processing.
    """

    __slots__ = ("bytes_written", "total_length", "data")

    bytes_written: int
    total_length: int
    data: bytearray

    def __init__(self, total_length: int):
        self.bytes_written = 0
        self.total_length = total_length
        self.data = bytearray(total_length)

    def write_blob(self, blob_data):
        blob_data_length = len(blob_data)
        if blob_data_length == 0:
            return

        # Validate write boundaries
        expected_final_size = self.bytes_written + blob_data_length
        if expected_final_size > self.total_length:
            raise ValueError(f"Chunk would exceed file size ({expected_final_size} > {self.total_length})")

        start_pos = self.bytes_written
        self.data[start_pos : start_pos + blob_data_length] = blob_data
        self.bytes_written += blob_data_length


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
                    "tool_parameters": tool_parameters,
                },
            },
            headers={
                "X-Plugin-ID": tool_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        files: dict[str, FileChunk] = {}
        for resp in response:
            if resp.type == ToolInvokeMessage.MessageType.BLOB_CHUNK:
                assert isinstance(resp.message, ToolInvokeMessage.BlobChunkMessage)
                # Get blob chunk information
                chunk_id = resp.message.id
                total_length = resp.message.total_length
                blob_data = resp.message.blob
                is_end = resp.message.end
                blob_data_length = len(blob_data)

                # Pre-check conditions to avoid unnecessary processing
                file_size_limit = dify_config.TOOL_FILE_SIZE_LIMIT
                chunk_size_limit = dify_config.TOOL_FILE_CHUNK_SIZE_LIMIT
                if total_length > file_size_limit:
                    raise ValueError(f"File size {total_length} exceeds limit of {file_size_limit} bytes")

                if blob_data_length > chunk_size_limit:
                    raise ValueError(f"Chunk size {blob_data_length} exceeds limit of {chunk_size_limit} bytes")

                # Initialize buffer for this file if it doesn't exist
                if chunk_id not in files:
                    files[chunk_id] = FileChunk(total_length)
                file_chunk = files[chunk_id]

                # If this is the final chunk, yield a complete blob message
                if is_end:
                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.BLOB,
                        message=ToolInvokeMessage.BlobMessage(blob=bytes(file_chunk.data)),
                        meta=resp.meta,
                    )
                    del files[chunk_id]
                else:
                    # Write the blob data to the file chunk
                    file_chunk.write_blob(blob_data)
            else:
                yield resp

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
