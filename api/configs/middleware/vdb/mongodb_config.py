from urllib.parse import quote, quote_plus, urlparse

from pydantic import Field, NonNegativeInt, computed_field, model_validator
from pydantic_settings import BaseSettings


# MongoDB error codes
class MongoDBErrorCode:
    """MongoDB operation error codes for error handling."""
    PERMISSION_DENIED = 13
    NAMESPACE_EXISTS = 48
    INDEX_ALREADY_EXISTS = 68


class MongoDBConfig(BaseSettings):
    """
    Configuration settings for MongoDB vector database
    """

    MONGODB_URI: str | None = Field(
        description="MongoDB Connection URI (e.g., 'mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority')",
        default=None,
    )

    MONGODB_HOST: str | None = Field(
        description="MongoDB Hostname",
        default=None,
    )

    MONGODB_PORT: int = Field(
        description="MongoDB Port",
        default=27017,
    )

    MONGODB_USERNAME: str | None = Field(
        description="MongoDB Username",
        default=None,
    )

    MONGODB_PASSWORD: str | None = Field(
        description="MongoDB Password",
        default=None,
    )

    MONGODB_DATABASE: str = Field(
        description="MongoDB Database Name",
        default="dify",
    )

    MONGODB_VECTOR_INDEX_NAME: str = Field(
        description="Vector Index Name",
        default="vector_index",
    )

    MONGODB_CONNECTION_RETRY_ATTEMPTS: NonNegativeInt = Field(
        description="Maximum number of connection retry attempts (default: 3)",
        default=3,
    )

    MONGODB_CONNECTION_RETRY_BACKOFF_BASE: float = Field(
        description="Base delay in seconds for exponential backoff on connection retries (default: 1.0)",
        default=1.0,
    )

    MONGODB_INDEX_READY_TIMEOUT: NonNegativeInt = Field(
        description="Maximum time in seconds to wait for index to become ready (default: 300)",
        default=300,
    )

    MONGODB_INDEX_READY_CHECK_DELAY: float = Field(
        description="Initial delay in seconds between index ready checks (default: 1.0)",
        default=1.0,
    )

    MONGODB_INDEX_READY_MAX_DELAY: float = Field(
        description="Maximum delay in seconds between index ready checks (default: 10.0)",
        default=10.0,
    )

    MONGODB_CONNECTION_RETRY_MAX_WAIT: float = Field(
        description="Maximum wait time in seconds for connection retry backoff (default: 30.0)",
        default=30.0,
    )

    def _build_connection_uri(self) -> str:
        """
        Build MongoDB connection URI from individual components.
        
        This is a sensitive operation as it constructs connection strings with credentials.
        All URI construction is logged (with sanitization) for security auditing.
        
        Returns:
            MongoDB connection URI string
            
        Raises:
            ValueError: If URI construction fails due to invalid components with clear error messages
        """
        import logging
        logger = logging.getLogger(__name__)
        
        try:
            if not self.MONGODB_HOST:
                logger.debug("Building MongoDB URI with default localhost connection")
                return "mongodb://localhost:27017"
            
            # Validate host is a string
            if not isinstance(self.MONGODB_HOST, str) or not self.MONGODB_HOST.strip():
                raise ValueError(
                    "MONGODB_HOST must be a non-empty string. "
                    f"Received: {type(self.MONGODB_HOST).__name__}"
                )
            
            # Validate port is within valid range
            if not isinstance(self.MONGODB_PORT, int) or not (1 <= self.MONGODB_PORT <= 65535):
                raise ValueError(
                    f"MONGODB_PORT must be an integer between 1 and 65535. "
                    f"Received: {self.MONGODB_PORT} (type: {type(self.MONGODB_PORT).__name__})"
                )
            
            auth = ""
            if self.MONGODB_USERNAME:
                # Validate username is a string
                if not isinstance(self.MONGODB_USERNAME, str):
                    raise ValueError(
                        f"MONGODB_USERNAME must be a string. "
                        f"Received: {type(self.MONGODB_USERNAME).__name__}"
                    )
                
                # Use quote_plus for username (handles spaces as +)
                # Use quote for password to handle special characters including colons
                try:
                    username = quote_plus(self.MONGODB_USERNAME)
                    password = quote(self.MONGODB_PASSWORD or "", safe="") if self.MONGODB_PASSWORD else ""
                except (TypeError, AttributeError) as e:
                    raise ValueError(
                        f"Failed to encode MongoDB credentials: {e}. "
                        "Please ensure MONGODB_USERNAME and MONGODB_PASSWORD are valid strings."
                    ) from e
                
                auth = f"{username}:{password}@"
                logger.debug(
                    f"Building MongoDB URI with authentication for host '{self.MONGODB_HOST}'"
                )
            else:
                logger.debug(
                    f"Building MongoDB URI without authentication for host '{self.MONGODB_HOST}'"
                )
            
            uri = f"mongodb://{auth}{self.MONGODB_HOST}:{self.MONGODB_PORT}"
            logger.debug(
                f"MongoDB URI constructed successfully (host: {self.MONGODB_HOST}, port: {self.MONGODB_PORT})"
            )
            return uri
        except ValueError:
            # Re-raise ValueError as-is (already has clear message)
            raise
        except (TypeError, AttributeError) as e:
            logger.error(
                f"Type error during MongoDB URI construction: {e}. "
                "Please check that all configuration values are of the correct type."
            )
            raise ValueError(
                f"Invalid MongoDB configuration type for URI construction: {e}. "
                "Please verify MONGODB_HOST (str), MONGODB_PORT (int), "
                "MONGODB_USERNAME (str), and MONGODB_PASSWORD (str) are correct types."
            ) from e
        except Exception as e:
            logger.error(
                f"Unexpected error during MongoDB URI construction: {e} (type: {type(e).__name__})"
            )
            raise ValueError(
                f"Unexpected error building MongoDB connection URI: {e}. "
                "Please check your MongoDB configuration settings."
            ) from e

    @computed_field
    @property
    def MONGODB_CONNECT_URI(self) -> str:
        """
        Get MongoDB connection URI.
        
        If MONGODB_URI is provided, it takes precedence.
        Otherwise, builds URI from individual components (host, port, username, password).
        """
        if self.MONGODB_URI:
            return self.MONGODB_URI
        return self._build_connection_uri()

    @model_validator(mode="after")
    def validate_mongodb_config(self):
        # Allow configuration if URI is explicitly provided, regardless of other fields.
        if self.MONGODB_URI:
            return self
            
        # If hosting details are provided but incomplete auth
        if self.MONGODB_HOST:
            # Enforce that if one auth field is present, both must be present.
            has_username = bool(self.MONGODB_USERNAME)
            has_password = bool(self.MONGODB_PASSWORD)
            
            if has_username != has_password:
                 raise ValueError("Both MONGODB_USERNAME and MONGODB_PASSWORD must be provided, or neither.")
            
        return self
