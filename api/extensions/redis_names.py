from configs import dify_config


def normalize_redis_key_prefix(prefix: str | None) -> str:
    """Normalize the configured Redis key prefix for consistent runtime use."""
    if prefix is None:
        return ""
    return prefix.strip()


def get_redis_key_prefix() -> str:
    """Read and normalize the current Redis key prefix from config."""
    return normalize_redis_key_prefix(dify_config.REDIS_KEY_PREFIX)


def serialize_redis_name(name: str, prefix: str | None = None) -> str:
    """Convert a logical Redis name into the physical name used in Redis."""
    normalized_prefix = get_redis_key_prefix() if prefix is None else normalize_redis_key_prefix(prefix)
    if not normalized_prefix:
        return name
    return f"{normalized_prefix}:{name}"


def serialize_redis_name_arg(name: str | bytes, prefix: str | None = None) -> str | bytes:
    """Prefix string Redis names while preserving bytes inputs unchanged."""
    if isinstance(name, bytes):
        return name
    return serialize_redis_name(name, prefix)


def serialize_redis_name_args(names: tuple[str | bytes, ...], prefix: str | None = None) -> tuple[str | bytes, ...]:
    return tuple(serialize_redis_name_arg(name, prefix) for name in names)
