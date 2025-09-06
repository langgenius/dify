from pydantic import Field
from pydantic_settings import BaseSettings


class MatrixoneConfig(BaseSettings):
    """Matrixone vector database configuration."""

    MATRIXONE_HOST: str = Field(default="localhost", description="Host address of the Matrixone server")
    MATRIXONE_PORT: int = Field(default=6001, description="Port number of the Matrixone server")
    MATRIXONE_USER: str = Field(default="dump", description="Username for authenticating with Matrixone")
    MATRIXONE_PASSWORD: str = Field(default="111", description="Password for authenticating with Matrixone")
    MATRIXONE_DATABASE: str = Field(default="dify", description="Name of the Matrixone database to connect to")
    MATRIXONE_METRIC: str = Field(
        default="l2", description="Distance metric type for vector similarity search (cosine or l2)"
    )
