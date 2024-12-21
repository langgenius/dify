from typing import Any, Union
from urllib.parse import urlparse

import boto3

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class S3Operator(BuiltinTool):
    s3_client: Any = None

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        try:
            # Initialize S3 client if not already done
            if not self.s3_client:
                aws_region = tool_parameters.get("aws_region")
                if aws_region:
                    self.s3_client = boto3.client("s3", region_name=aws_region)
                else:
                    self.s3_client = boto3.client("s3")

            # Parse S3 URI
            s3_uri = tool_parameters.get("s3_uri")
            if not s3_uri:
                return self.create_text_message("s3_uri parameter is required")

            parsed_uri = urlparse(s3_uri)
            if parsed_uri.scheme != "s3":
                return self.create_text_message("Invalid S3 URI format. Must start with 's3://'")

            bucket = parsed_uri.netloc
            # Remove leading slash from key
            key = parsed_uri.path.lstrip("/")

            operation_type = tool_parameters.get("operation_type", "read")
            generate_presign_url = tool_parameters.get("generate_presign_url", False)
            presign_expiry = int(tool_parameters.get("presign_expiry", 3600))  # default 1 hour

            if operation_type == "write":
                text_content = tool_parameters.get("text_content")
                if not text_content:
                    return self.create_text_message("text_content parameter is required for write operation")

                # Write content to S3
                self.s3_client.put_object(Bucket=bucket, Key=key, Body=text_content.encode("utf-8"))
                result = f"s3://{bucket}/{key}"

                # Generate presigned URL for the written object if requested
                if generate_presign_url:
                    result = self.s3_client.generate_presigned_url(
                        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=presign_expiry
                    )

            else:  # read operation
                # Get object from S3
                response = self.s3_client.get_object(Bucket=bucket, Key=key)
                result = response["Body"].read().decode("utf-8")

                # Generate presigned URL if requested
                if generate_presign_url:
                    result = self.s3_client.generate_presigned_url(
                        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=presign_expiry
                    )

            return self.create_text_message(text=result)

        except self.s3_client.exceptions.NoSuchBucket:
            return self.create_text_message(f"Bucket '{bucket}' does not exist")
        except self.s3_client.exceptions.NoSuchKey:
            return self.create_text_message(f"Object '{key}' does not exist in bucket '{bucket}'")
        except Exception as e:
            return self.create_text_message(f"Exception: {str(e)}")
