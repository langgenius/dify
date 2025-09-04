from configs import dify_config


def parse_endpoint_id(endpoint_id: str) -> str:
    return f"{dify_config.CONSOLE_API_URL}/triggers/plugin/{endpoint_id}"
