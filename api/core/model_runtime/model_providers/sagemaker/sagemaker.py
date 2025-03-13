import logging
import uuid
from typing import IO, Any

from core.model_runtime.model_providers.__base.model_provider import ModelProvider

logger = logging.getLogger(__name__)


class SageMakerProvider(ModelProvider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        """
        Validate provider credentials

        if validate failed, raise exception

        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        """
        pass


def buffer_to_s3(s3_client: Any, file: IO[bytes], bucket: str, s3_prefix: str) -> str:
    """
    return s3_uri of this file
    """
    s3_key = f"{s3_prefix}{uuid.uuid4()}.mp3"
    s3_client.put_object(Body=file.read(), Bucket=bucket, Key=s3_key, ContentType="audio/mp3")
    return s3_key


def generate_presigned_url(s3_client: Any, file: IO[bytes], bucket_name: str, s3_prefix: str, expiration=600) -> str:
    object_key = buffer_to_s3(s3_client, file, bucket_name, s3_prefix)
    try:
        response = s3_client.generate_presigned_url(
            "get_object", Params={"Bucket": bucket_name, "Key": object_key}, ExpiresIn=expiration
        )
    except Exception as e:
        print(f"Error generating presigned URL: {e}")
        return None

    return response
