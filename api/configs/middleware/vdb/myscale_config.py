from pydantic import BaseModel, Field, PositiveInt


class MyScaleConfig(BaseModel):
    """
    Configuration settings for MyScale vector database
    """

    MYSCALE_HOST: str = Field(
        description="Hostname or IP address of the MyScale server (e.g., 'localhost' or 'myscale.example.com')",
        default="localhost",
    )

    MYSCALE_PORT: PositiveInt = Field(
        description="Port number on which the MyScale server is listening (default is 8123)",
        default=8123,
    )

    MYSCALE_USER: str = Field(
        description="Username for authenticating with MyScale (default is 'default')",
        default="default",
    )

    MYSCALE_PASSWORD: str = Field(
        description="Password for authenticating with MyScale (default is an empty string)",
        default="",
    )

    MYSCALE_DATABASE: str = Field(
        description="Name of the MyScale database to connect to (default is 'default')",
        default="default",
    )

    MYSCALE_FTS_PARAMS: str = Field(
        description="Additional parameters for MyScale Full Text Search index)",
        default="",
    )
