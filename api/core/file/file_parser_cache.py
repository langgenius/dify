from typing import Optional

from extensions.ext_redis import redis_client


class FileParserCache:
    def __init__(self, file_id: str, file_type: str, separation_type: str):
        self.cache_key = f"media:{separation_type}:{file_id}.{file_type}"

    def get(self) -> Optional[dict]:
        """
        Get cached model provider credentials.

        :return:
        """
        cached_file_parser = redis_client.get(self.cache_key)
        if cached_file_parser:
            try:
                cached_file_parser = cached_file_parser.decode('utf-8')
            except:
                pass
            return cached_file_parser
        else:
            return None

    def set(self, file_content: str, ttl: Optional[int] = 86400) -> None:
        """
        Cache model provider credentials.

        :param file_content: file content
        :param ttl: cache expiration time in seconds
        :return:
        """
        redis_client.setex(name=self.cache_key, time=ttl, value=file_content)

    def delete(self) -> None:
        """
        Delete cached model provider credentials.

        :return:
        """
        redis_client.delete(self.cache_key)
