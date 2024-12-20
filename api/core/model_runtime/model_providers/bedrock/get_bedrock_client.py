from collections.abc import Mapping

import boto3
from botocore.config import Config

from core.model_runtime.errors.invoke import InvokeBadRequestError


def get_bedrock_client(service_name: str, credentials: Mapping[str, str]):
    region_name = credentials.get("aws_region")
    if not region_name:
        raise InvokeBadRequestError("aws_region is required")
    client_config = Config(region_name=region_name)
    aws_access_key_id = credentials.get("aws_access_key_id")
    aws_secret_access_key = credentials.get("aws_secret_access_key")

    if aws_access_key_id and aws_secret_access_key:
        # use aksk to call bedrock
        client = boto3.client(
            service_name=service_name,
            config=client_config,
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
        )
    else:
        # use iam without aksk to call
        client = boto3.client(service_name=service_name, config=client_config)

    return client
