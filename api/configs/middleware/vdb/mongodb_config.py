import re
from urllib.parse import quote_plus, urlparse

from pydantic import Field, computed_field, model_validator
from pydantic_settings import BaseSettings


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
        ge=1,
        le=65535,
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
        min_length=1,
    )

    MONGODB_VECTOR_INDEX_NAME: str = Field(
        description="Vector Index Name",
        default="vector_index",
        min_length=1,
    )

    @computed_field
    @property
    def MONGODB_CONNECT_URI(self) -> str:
        if self.MONGODB_URI:
            return self.MONGODB_URI
        
        if not self.MONGODB_HOST:
             return "mongodb://localhost:27017"
        
        auth = ""
        if self.MONGODB_USERNAME:
            password = quote_plus(self.MONGODB_PASSWORD) if self.MONGODB_PASSWORD else ""
            auth = f"{quote_plus(self.MONGODB_USERNAME)}:{password}@"
        
        return f"mongodb://{auth}{self.MONGODB_HOST}:{self.MONGODB_PORT}"

    @staticmethod
    def _validate_mongodb_uri(uri: str) -> None:
        """
        Validate MongoDB URI format.
        
        Raises:
            ValueError: If the URI format is invalid.
        """
        if not uri or not isinstance(uri, str):
            raise ValueError("MongoDB URI must be a non-empty string.")
        
        # Check for valid MongoDB URI schemes
        valid_schemes = ["mongodb", "mongodb+srv"]
        parsed = urlparse(uri)
        
        if parsed.scheme not in valid_schemes:
            raise ValueError(
                f"Invalid MongoDB URI scheme: {parsed.scheme}. "
                f"Must be one of: {', '.join(valid_schemes)}"
            )
        
        # For mongodb+srv, hostname is required
        if parsed.scheme == "mongodb+srv" and not parsed.hostname:
            raise ValueError("mongodb+srv URI must include a hostname.")
        
        # For standard mongodb://, validate host and port format
        if parsed.scheme == "mongodb":
            if not parsed.hostname:
                raise ValueError("mongodb:// URI must include a hostname.")
            
            # Validate hostname format (basic check)
            if not re.match(r"^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$", parsed.hostname):
                # Allow IP addresses
                if not re.match(r"^(\d{1,3}\.){3}\d{1,3}$", parsed.hostname):
                    raise ValueError(f"Invalid hostname format: {parsed.hostname}")
        
        # Validate database name if present in URI
        if parsed.path and len(parsed.path) > 1:
            db_name = parsed.path.lstrip("/").split("/")[0]
            if not re.match(r"^[a-zA-Z0-9_-]+$", db_name):
                raise ValueError(f"Invalid database name in URI: {db_name}")

    @model_validator(mode="after")
    def validate_mongodb_config(self):
        """
        Validate MongoDB configuration settings.
        
        Raises:
            ValueError: If configuration is invalid.
        """
        # Validate URI if provided
        if self.MONGODB_URI:
            self._validate_mongodb_uri(self.MONGODB_URI)
            return self
        
        # Validate host configuration
        if self.MONGODB_HOST:
            # Validate hostname format
            if not isinstance(self.MONGODB_HOST, str) or not self.MONGODB_HOST.strip():
                raise ValueError("MONGODB_HOST must be a non-empty string.")
            
            # Basic hostname/IP validation
            hostname = self.MONGODB_HOST.strip()
            is_valid_hostname = re.match(
                r"^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$",
                hostname
            )
            is_valid_ip = re.match(r"^(\d{1,3}\.){3}\d{1,3}$", hostname)
            
            if not (is_valid_hostname or is_valid_ip):
                raise ValueError(f"Invalid MONGODB_HOST format: {hostname}")
            
            # Enforce that if one auth field is present, both must be present.
            # This prevents accidental misconfigurations where a password might be missing.
            has_username = bool(self.MONGODB_USERNAME)
            has_password = bool(self.MONGODB_PASSWORD)
            
            if has_username != has_password:
                raise ValueError(
                    "Both MONGODB_USERNAME and MONGODB_PASSWORD must be provided, or neither."
                )
        
        # Validate database name
        if not self.MONGODB_DATABASE or not isinstance(self.MONGODB_DATABASE, str):
            raise ValueError("MONGODB_DATABASE must be a non-empty string.")
        
        if not re.match(r"^[a-zA-Z0-9_-]+$", self.MONGODB_DATABASE):
            raise ValueError(
                f"Invalid MONGODB_DATABASE format: {self.MONGODB_DATABASE}. "
                "Database names can only contain alphanumeric characters, underscores, and hyphens."
            )
        
        # Validate index name
        if not self.MONGODB_VECTOR_INDEX_NAME or not isinstance(self.MONGODB_VECTOR_INDEX_NAME, str):
            raise ValueError("MONGODB_VECTOR_INDEX_NAME must be a non-empty string.")
        
        if not re.match(r"^[a-zA-Z0-9_-]+$", self.MONGODB_VECTOR_INDEX_NAME):
            raise ValueError(
                f"Invalid MONGODB_VECTOR_INDEX_NAME format: {self.MONGODB_VECTOR_INDEX_NAME}. "
                "Index names can only contain alphanumeric characters, underscores, and hyphens."
            )
        
        return self
