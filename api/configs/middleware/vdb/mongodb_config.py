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

    MONGODB_SERVER_SELECTION_TIMEOUT_MS: NonNegativeInt = Field(
        description="Server selection timeout in milliseconds for MongoDB client (default: 5000). "
        "Set to 0 to use pymongo default timeout.",
        default=5000,
    )

    def _build_connection_uri(self) -> str:
        """
        Build MongoDB connection URI from individual components.
        
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
            
            if not isinstance(self.MONGODB_HOST, str) or not self.MONGODB_HOST.strip():
                raise ValueError(
                    "MONGODB_HOST must be a non-empty string. "
                    f"Received: {type(self.MONGODB_HOST).__name__}"
                )
            
            if not isinstance(self.MONGODB_PORT, int) or not (1 <= self.MONGODB_PORT <= 65535):
                raise ValueError(
                    f"MONGODB_PORT must be an integer between 1 and 65535. "
                    f"Received: {self.MONGODB_PORT} (type: {type(self.MONGODB_PORT).__name__})"
                )
            
            auth = ""
            if self.MONGODB_USERNAME:
                if not isinstance(self.MONGODB_USERNAME, str):
                    raise ValueError(
                        f"MONGODB_USERNAME must be a string. "
                        f"Received: {type(self.MONGODB_USERNAME).__name__}"
                    )
                
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
            raise
        except (TypeError, AttributeError) as e:
            error_msg = (
                f"Invalid MongoDB configuration type for URI construction: {e} (type: {type(e).__name__}). "
                "Please verify MONGODB_HOST (str), MONGODB_PORT (int), "
                "MONGODB_USERNAME (str), and MONGODB_PASSWORD (str) are correct types."
            )
            logger.error(error_msg, exc_info=True)
            raise ValueError(error_msg) from e
        except (UnicodeEncodeError, RuntimeError) as e:
            error_msg = (
                f"Failed to build MongoDB connection URI due to encoding or runtime error: {e} "
                f"(type: {type(e).__name__}). Please check your MongoDB configuration settings."
            )
            logger.error(error_msg, exc_info=True)
            raise ValueError(error_msg) from e

    @computed_field
    @property
    def MONGODB_CONNECT_URI(self) -> str:
        """
        Get MongoDB connection URI.
        
        If MONGODB_URI is provided, it takes precedence.
        Otherwise, builds URI from individual components (host, port, username, password).
        
        Raises:
            ValueError: If URI construction fails or MONGODB_URI is invalid
        """
        import logging
        logger = logging.getLogger(__name__)
        
        if self.MONGODB_URI:
            if not isinstance(self.MONGODB_URI, str) or not self.MONGODB_URI.strip():
                raise ValueError(
                    "MONGODB_URI must be a non-empty string. "
                    f"Received: {type(self.MONGODB_URI).__name__}"
                )
            # Validate URI format
            if "://" not in self.MONGODB_URI:
                raise ValueError(
                    f"Invalid MONGODB_URI format: missing scheme (mongodb:// or mongodb+srv://). "
                    f"URI must start with 'mongodb://' or 'mongodb+srv://'"
                )
            return self.MONGODB_URI
        
        try:
            return self._build_connection_uri()
        except ValueError:
            # Re-raise ValueError as-is (already has clear error message)
            raise
        except (AttributeError, RuntimeError) as e:
            error_msg = (
                f"Failed to get MongoDB connection URI: {e} (type: {type(e).__name__}). "
                "Please check your MongoDB configuration settings."
            )
            logger.error(error_msg, exc_info=True)
            raise ValueError(error_msg) from e

    @model_validator(mode="after")
    def validate_mongodb_config(self):
        if self.MONGODB_URI:
            return self
            
        if self.MONGODB_HOST:
            has_username = bool(self.MONGODB_USERNAME)
            has_password = bool(self.MONGODB_PASSWORD)
            
            if has_username != has_password:
                 raise ValueError("Both MONGODB_USERNAME and MONGODB_PASSWORD must be provided, or neither.")
            
        return self
