from collections.abc import Generator
from typing import Any, Optional

from pydantic import BaseModel

from core.plugin.entities.plugin import GenericProviderID, ToolProviderID
from core.plugin.entities.plugin_daemon import PluginBasicBooleanResponse, PluginToolProviderEntity
from core.plugin.impl.base import BasePluginClient
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter


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

        class FileChunk:
            """
            Only used for internal processing.
            """

            bytes_written: int
            total_length: int
            data: bytearray

            def __init__(self, total_length: int):
                self.bytes_written = 0
                self.total_length = total_length
                self.data = bytearray(total_length)

        files: dict[str, FileChunk] = {}
        CHUNK_SIZE_LIMIT = 8192
        FILE_SIZE_LIMIT = 30 * 1024 * 1024
        for resp in response:
            if resp.type == ToolInvokeMessage.MessageType.BLOB_CHUNK:
                assert isinstance(resp.message, ToolInvokeMessage.BlobChunkMessage)
                # Get blob chunk information
                chunk_id = resp.message.id
                total_length = resp.message.total_length
                blob_data = resp.message.blob
                is_end = resp.message.end

                # Pre-check conditions to avoid unnecessary processing
                if total_length > FILE_SIZE_LIMIT:
                    raise ValueError(f"File size {total_length} exceeds limit of {FILE_SIZE_LIMIT} bytes")

                if len(blob_data) > CHUNK_SIZE_LIMIT:
                    raise ValueError(f"Chunk size {len(blob_data)} exceeds limit of {CHUNK_SIZE_LIMIT} bytes")

                # Initialize buffer for this file if it doesn't exist
                if chunk_id not in files:
                    files[chunk_id] = FileChunk(total_length)
                file_chunk = files[chunk_id]

                # Validate write boundaries
                expected_final_size = file_chunk.bytes_written + len(blob_data)
                if expected_final_size > file_chunk.total_length:
                    raise ValueError(
                        f"Chunk would exceed file size ({expected_final_size} > {file_chunk.total_length})"
                    )

                # Handle non-final chunks
                start_pos = file_chunk.bytes_written
                file_chunk.data[start_pos : start_pos + len(blob_data)] = blob_data
                file_chunk.bytes_written += len(blob_data)

                # If this is the final chunk, yield a complete blob message
                if is_end:
                    if file_chunk.bytes_written != file_chunk.total_length:
                        raise ValueError(
                            f"File length {file_chunk.bytes_written} doesn't match"
                            f" expected size {file_chunk.total_length}"
                        )
                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.BLOB,
                        message=ToolInvokeMessage.BlobMessage(blob=bytes(file_chunk.data)),
                        meta=resp.meta,
                    )
                    del files[chunk_id]
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
