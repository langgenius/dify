from pydantic import Field
from pydantic_settings import BaseSettings


class MqInfo(BaseSettings):
    """
    Packaging build information
    """

    MQ_HOST: str = Field(
        description="Rabbit Mq host",
        default="127.0.0.1",
    )

