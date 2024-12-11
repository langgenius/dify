import boto3
from botocore.config import Config


def get_bedrock_client(service_name, credentials=None):
    client_config = Config(region_name=credentials["aws_region"])
    aws_access_key_id = (credentials["aws_access_key_id"],)
    aws_secret_access_key = credentials["aws_secret_access_key"]
    if aws_access_key_id and aws_secret_access_key:
        # 使用 AKSK 方式
        client = boto3.client(
            service_name=service_name,
            config=client_config,
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
        )
    else:
        # 使用 IAM 角色方式
        client = boto3.client(service_name=service_name, config=client_config)

    return client
