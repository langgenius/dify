import io
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Union

from azure.core.exceptions import ResourceExistsError
from azure.storage.blob import BlobSasPermissions, BlobServiceClient, ContentSettings, generate_blob_sas

from core.file.file_manager import download
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class EphemeralFireShareTool(BuiltinTool):
    """
    Tool to upload a file to Azure Blob Storage and generate a Shared Access URL for the file.
    """

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        # Ensure runtime and credentials
        if not self.runtime or not self.runtime.credentials:
            raise ToolProviderCredentialValidationError("Tool runtime or credentials are missing")

        # Get account name
        account_name = self.runtime.credentials.get("azure_blob_storage_account_name")
        if not account_name:
            raise ValueError("Azure Blob Storage connection string is required")

        # Get API key
        api_key = self.runtime.credentials.get("azure_blob_storage_api_key")
        if not api_key:
            raise ValueError("Azure Blob Storage API Key is required")

        # get container name
        container_name = tool_parameters.get("container_name")
        if not container_name:
            raise ValueError("Container name is required")

        # get file prefix
        file_prefix = tool_parameters.get("file_prefix")
        # create a blob client using the connection string
        blob_service_client = BlobServiceClient(
            account_url=f"https://{account_name}.blob.core.windows.net", credential=api_key
        )

        # get duration
        overwrite = tool_parameters.get("duration", 5)

        # get stop_on_error flag
        stop_on_error = tool_parameters.get("stop_on_error", True)

        # create container
        try:
            blob_service_client.create_container(name=container_name)
        except ResourceExistsError:
            pass
        except Exception as exc:
            if stop_on_error:
                raise ValueError("Failed to create container") from exc
            else:
                return [
                    self.create_text_message("Failed to create container"),
                    self.create_json_message({"error": "Failed to create container"}),
                ]

        # Get file
        file = tool_parameters.get("file")
        if not file:
            raise ValueError("File is required")

        file_id = uuid.uuid4().hex
        filename = file.filename or None
        mime_type = file.mime_type or None
        file_binary = io.BytesIO(download(file))

        # blob name is masked with fileid.
        # If file_prefix is provided, then it will be used as a prefix
        blob = f"{file_prefix}{file_id}" if file_prefix else file_id

        # content settings including content type and content disposition
        content_disposition: str = f'attachment; filename="{filename}"' if filename else "attachment"
        content_settings = ContentSettings(content_type=mime_type, content_disposition=content_disposition)

        # upload file to blob storage
        blob_client = blob_service_client.get_blob_client(container=container_name, blob=blob)
        try:
            blob_client.upload_blob(file_binary, content_settings=content_settings, overwrite=overwrite)
        except Exception as exc:
            if stop_on_error:
                raise ValueError("Failed to upload file") from exc
            else:
                return [
                    self.create_text_message(f'Failed to upload file "{filename}" to container "{container_name}"'),
                    self.create_json_message(
                        {"error": f'Failed to upload file "{filename}" to container "{container_name}"'}
                    ),
                ]

        # get blob properties for response
        blob_properties = blob_client.get_blob_properties()
        result_content_settings = blob_properties.content_settings or None

        # create SAS token for the uploaded file
        try:
            expiry = datetime.now(UTC) + timedelta(minutes=overwrite)
            sas_token = generate_blob_sas(
                account_name=account_name,
                container_name=container_name,
                blob_name=blob,
                account_key=api_key,
                permission=BlobSasPermissions(read=True, write=False, delete=False, list=False),
                expiry=expiry,
            )
            shared_access_url = f"https://{account_name}.blob.core.windows.net/{container_name}/{blob}?{sas_token}"
        except Exception as exc:
            if stop_on_error:
                raise ValueError("Failed to generate SAS token") from exc
            else:
                return [
                    self.create_text_message(f'Failed to generate SAS token for file "{filename}"'),
                    self.create_json_message({"error": f'Failed to generate SAS token for file "{filename}"'}),
                ]

        result = {
            "name": blob_properties.name or None,
            "container": blob_properties.container or None,
            "size": blob_properties.size or None,
            "creation_time": blob_properties.creation_time.isoformat() or None,
            "last_modified": blob_properties.last_modified.isoformat() or None,
            "content_type": result_content_settings.content_type if result_content_settings else None,
            "content_disposition": result_content_settings.content_disposition if result_content_settings else None,
            "expiry": expiry.isoformat(),
            "sas_token": sas_token,
            "shared_access_url": shared_access_url,
        }

        return [
            self.create_text_message(
                f"Shared Access URL is {shared_access_url} ", f"This URL will expire in {overwrite} minutes."
            ),
            self.create_json_message(result),
        ]
