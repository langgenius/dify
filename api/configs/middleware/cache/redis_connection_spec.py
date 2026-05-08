"""Structured connection specification for Redis clients.

``RedisConnectionSpec`` describes how to connect to a Redis deployment
across three topologies (standalone, Sentinel, Cluster). It replaces the
URL-string configuration contract that could not encode Sentinel topology
(sentinel needs a list of sentinel nodes plus a service name, which cannot
fit into a single URL string).

Both the main Redis client and the Event Bus (pub/sub) client are built
from a ``RedisConnectionSpec``. The pub/sub spec defaults to inheriting
the main client's spec; it can be overridden with a different spec to
route streaming events to an independent Redis deployment (e.g. a
dedicated Cluster when pub/sub traffic is the bottleneck).

Specs are immutable and hashable so ``==`` comparison cleanly answers
"do main and pub/sub point to the same deployment?" — which lets the
Event Bus reuse the main client object (and its connection pool /
failover-aware Sentinel handle) without a second connection path.
"""

from dataclasses import dataclass
from typing import Literal, Protocol

RedisMode = Literal["standalone", "sentinel", "cluster"]

# (host, port) pair. Tuple so the whole spec stays hashable.
HostPort = tuple[str, int]


class PubSubConfigProtocol(Protocol):
    """Subset of ``RedisPubSubConfig`` fields that the pub/sub builder reads.

    ``PUBSUB_REDIS_MODE`` (when set) triggers structured-field construction
    and unlocks independent Sentinel topologies. When unset, the pub/sub
    spec is inherited from the main Redis spec, letting Dify reuse the
    main client object and its failover-aware Sentinel handle.
    """

    # Structured mode selector — set to declare an independent pub/sub topology.
    PUBSUB_REDIS_MODE: RedisMode | None

    # Structured standalone fields
    PUBSUB_REDIS_HOST: str | None
    PUBSUB_REDIS_PORT: int | None
    PUBSUB_REDIS_DB: int | None

    # Structured sentinel fields
    PUBSUB_REDIS_SENTINELS: str | None
    PUBSUB_REDIS_SENTINEL_SERVICE_NAME: str | None
    PUBSUB_REDIS_SENTINEL_USERNAME: str | None
    PUBSUB_REDIS_SENTINEL_PASSWORD: str | None
    PUBSUB_REDIS_SENTINEL_SOCKET_TIMEOUT: float | None

    # Structured cluster fields
    PUBSUB_REDIS_CLUSTERS: str | None

    # Common credentials / SSL (used by all three structured modes)
    PUBSUB_REDIS_USERNAME: str | None
    PUBSUB_REDIS_PASSWORD: str | None
    PUBSUB_REDIS_USE_SSL: bool | None


class MainRedisConfigProtocol(Protocol):
    """Subset of ``RedisConfig`` fields that the main-client builder reads.

    Declared as a Protocol (not a concrete base class) so tests can supply
    a lightweight stand-in (e.g. ``SimpleNamespace``) without instantiating
    the full pydantic-settings hierarchy.
    """

    REDIS_HOST: str
    REDIS_PORT: int
    REDIS_USERNAME: str | None
    REDIS_PASSWORD: str | None
    REDIS_DB: int
    REDIS_USE_SSL: bool
    REDIS_SSL_CERT_REQS: str
    REDIS_SSL_CA_CERTS: str | None
    REDIS_SSL_CERTFILE: str | None
    REDIS_SSL_KEYFILE: str | None
    REDIS_USE_SENTINEL: bool | None
    REDIS_SENTINELS: str | None
    REDIS_SENTINEL_SERVICE_NAME: str | None
    REDIS_SENTINEL_USERNAME: str | None
    REDIS_SENTINEL_PASSWORD: str | None
    REDIS_SENTINEL_SOCKET_TIMEOUT: float | None
    REDIS_USE_CLUSTERS: bool
    REDIS_CLUSTERS: str | None
    REDIS_CLUSTERS_PASSWORD: str | None


def _mask_secret(value: str | None) -> str:
    """Render a secret field safely for logs / repr.

    Returns ``"***"`` when a secret is set and ``"None"`` when it is unset,
    so readers can still distinguish "no password configured" from
    "password configured but redacted".
    """
    return "***" if value else "None"


@dataclass(frozen=True)
class RedisConnectionSpec:
    """Connection parameters for a Redis deployment.

    Exactly one of the three mode-specific field groups is required, keyed
    by ``mode``:

    - ``mode="standalone"`` — requires ``host`` and ``port``
    - ``mode="sentinel"`` — requires ``sentinel_nodes`` (non-empty) and
      ``sentinel_service_name``
    - ``mode="cluster"`` — requires ``cluster_nodes`` (non-empty)

    ``__post_init__`` enforces the required-field invariant at
    construction time so callers never see a half-formed spec.

    Immutable (``frozen=True``) and hashable so specs can participate in
    value-equality comparisons — the "is pub/sub spec identical to main
    spec" check that enables client reuse relies on this.
    """

    mode: RedisMode

    # --- common credentials ---
    username: str | None = None
    password: str | None = None

    # --- common transport ---
    # ``db`` is only meaningful in standalone mode — Cluster disables
    # SELECT DB and Sentinel clients inherit db from base redis params.
    db: int = 0
    use_ssl: bool = False
    ssl_cert_reqs: str = "CERT_NONE"
    ssl_ca_certs: str | None = None
    ssl_certfile: str | None = None
    ssl_keyfile: str | None = None

    # --- standalone ---
    host: str | None = None
    port: int | None = None

    # --- sentinel ---
    sentinel_nodes: tuple[HostPort, ...] = ()
    sentinel_service_name: str | None = None
    sentinel_username: str | None = None
    sentinel_password: str | None = None
    sentinel_socket_timeout: float | None = None

    # --- cluster ---
    cluster_nodes: tuple[HostPort, ...] = ()

    def __post_init__(self) -> None:
        match self.mode:
            case "standalone":
                if not self.host:
                    raise ValueError("standalone mode requires host")
                if not self.port:
                    raise ValueError("standalone mode requires port")
            case "sentinel":
                if not self.sentinel_nodes:
                    raise ValueError("sentinel mode requires non-empty sentinel_nodes")
                if not self.sentinel_service_name:
                    raise ValueError("sentinel mode requires sentinel_service_name")
            case "cluster":
                if not self.cluster_nodes:
                    raise ValueError("cluster mode requires non-empty cluster_nodes")
            case _:
                raise ValueError(f"Unknown mode: {self.mode!r}")

    def __repr__(self) -> str:
        """Safe repr — masks ``password`` and ``sentinel_password``.

        The default dataclass ``__repr__`` would dump every field
        verbatim, which would surface credentials in startup logs and
        exception tracebacks. This override redacts the two secret fields
        while keeping topology fields visible for debugging.
        """
        return (
            "RedisConnectionSpec("
            f"mode={self.mode!r}, "
            f"host={self.host!r}, port={self.port!r}, db={self.db!r}, "
            f"use_ssl={self.use_ssl!r}, "
            f"sentinel_nodes={self.sentinel_nodes!r}, "
            f"sentinel_service_name={self.sentinel_service_name!r}, "
            f"sentinel_socket_timeout={self.sentinel_socket_timeout!r}, "
            f"cluster_nodes={self.cluster_nodes!r}, "
            f"username={self.username!r}, "
            f"password={_mask_secret(self.password)}, "
            f"sentinel_username={self.sentinel_username!r}, "
            f"sentinel_password={_mask_secret(self.sentinel_password)}"
            ")"
        )

    def __str__(self) -> str:
        """Short human-readable summary suitable for startup logs.

        Truncates node lists to the first 3 entries followed by ``...``
        so a 20-shard cluster doesn't flood logs with a single line.
        """
        match self.mode:
            case "standalone":
                return f"Redis(standalone, {self.host}:{self.port}, db={self.db})"
            case "sentinel":
                preview = ",".join(f"{host}:{port}" for host, port in self.sentinel_nodes[:3])
                suffix = "..." if len(self.sentinel_nodes) > 3 else ""
                return f"Redis(sentinel, service={self.sentinel_service_name}, nodes=[{preview}{suffix}])"
            case "cluster":
                preview = ",".join(f"{host}:{port}" for host, port in self.cluster_nodes[:3])
                suffix = "..." if len(self.cluster_nodes) > 3 else ""
                return f"Redis(cluster, nodes=[{preview}{suffix}])"


def _parse_host_port_list(raw: str | None, env_name: str) -> tuple[HostPort, ...]:
    """Parse a comma-separated ``host:port[,host:port]`` env value.

    Tolerates leading/trailing whitespace per entry. Blank entries
    (produced by trailing commas or double commas) are skipped.

    On malformed entries, raises with the **1-based position** instead of
    echoing the raw content — an operator who accidentally pasted a DSN
    like ``password@host`` would otherwise leak the password into startup
    logs via the exception message.

    Note: IPv6 literals must use bracketed form (``[fe80::1]:7001``);
    ``rpartition(":")`` cannot disambiguate bare-colon IPv6 addresses
    from ``host:port``.
    """
    if not raw:
        return ()
    result: list[HostPort] = []
    for index, raw_entry in enumerate(raw.split(","), start=1):
        entry = raw_entry.strip()
        if not entry:
            continue
        host, sep, port_str = entry.rpartition(":")
        if not sep or not host or not port_str.isdigit():
            raise ValueError(f"{env_name} entry at position {index} is malformed; expected 'host:port' format")
        result.append((host, int(port_str)))
    return tuple(result)


def build_main_redis_spec(config: MainRedisConfigProtocol) -> RedisConnectionSpec:
    """Translate the flat ``REDIS_*`` env fields into a ``RedisConnectionSpec``.

    Rejects the invalid "Sentinel and Cluster both enabled" combination
    up front so it never reaches client construction. Each mode-specific
    branch produces a fully-validated spec (``RedisConnectionSpec.__post_init__``
    re-checks the required fields, so any hand-crafted ``cfg`` that
    escapes this function's checks still fails fast).
    """
    use_sentinel = bool(config.REDIS_USE_SENTINEL)
    use_cluster = bool(config.REDIS_USE_CLUSTERS)

    if use_sentinel and use_cluster:
        raise ValueError(
            "REDIS_USE_SENTINEL and REDIS_USE_CLUSTERS are both enabled; only one topology mode can be active at a time"
        )

    ssl_kwargs: dict[str, object] = {
        "use_ssl": config.REDIS_USE_SSL,
        "ssl_cert_reqs": config.REDIS_SSL_CERT_REQS,
        "ssl_ca_certs": config.REDIS_SSL_CA_CERTS,
        "ssl_certfile": config.REDIS_SSL_CERTFILE,
        "ssl_keyfile": config.REDIS_SSL_KEYFILE,
    }

    if use_sentinel:
        nodes = _parse_host_port_list(config.REDIS_SENTINELS, env_name="REDIS_SENTINELS")
        if not nodes:
            raise ValueError("REDIS_USE_SENTINEL is True but REDIS_SENTINELS is empty")
        if not config.REDIS_SENTINEL_SERVICE_NAME:
            raise ValueError("REDIS_USE_SENTINEL is True but REDIS_SENTINEL_SERVICE_NAME is unset")
        return RedisConnectionSpec(
            mode="sentinel",
            username=config.REDIS_USERNAME,
            password=config.REDIS_PASSWORD or None,
            db=config.REDIS_DB,
            sentinel_nodes=nodes,
            sentinel_service_name=config.REDIS_SENTINEL_SERVICE_NAME,
            sentinel_username=config.REDIS_SENTINEL_USERNAME,
            sentinel_password=config.REDIS_SENTINEL_PASSWORD,
            sentinel_socket_timeout=config.REDIS_SENTINEL_SOCKET_TIMEOUT,
            **ssl_kwargs,  # type: ignore[arg-type]
        )

    if use_cluster:
        nodes = _parse_host_port_list(config.REDIS_CLUSTERS, env_name="REDIS_CLUSTERS")
        if not nodes:
            raise ValueError("REDIS_USE_CLUSTERS is True but REDIS_CLUSTERS is empty")
        # Cluster password precedence: dedicated env wins over shared REDIS_PASSWORD.
        password = config.REDIS_CLUSTERS_PASSWORD or config.REDIS_PASSWORD or None
        return RedisConnectionSpec(
            mode="cluster",
            username=config.REDIS_USERNAME,
            password=password,
            cluster_nodes=nodes,
            **ssl_kwargs,  # type: ignore[arg-type]
        )

    return RedisConnectionSpec(
        mode="standalone",
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        username=config.REDIS_USERNAME,
        password=config.REDIS_PASSWORD or None,
        db=config.REDIS_DB,
        **ssl_kwargs,  # type: ignore[arg-type]
    )


def _spec_from_pubsub_fields(cfg: PubSubConfigProtocol) -> RedisConnectionSpec:
    """Build a spec from the structured ``PUBSUB_REDIS_*`` fields.

    Credentials and SSL are treated as independent from the main spec —
    an operator who declares a separate topology likely has separate
    credentials and must set them explicitly.
    """
    mode = cfg.PUBSUB_REDIS_MODE
    use_ssl = bool(cfg.PUBSUB_REDIS_USE_SSL)

    match mode:
        case "standalone":
            if not cfg.PUBSUB_REDIS_HOST:
                raise ValueError("PUBSUB_REDIS_MODE=standalone requires PUBSUB_REDIS_HOST")
            if not cfg.PUBSUB_REDIS_PORT:
                raise ValueError("PUBSUB_REDIS_MODE=standalone requires PUBSUB_REDIS_PORT")
            return RedisConnectionSpec(
                mode="standalone",
                host=cfg.PUBSUB_REDIS_HOST,
                port=cfg.PUBSUB_REDIS_PORT,
                db=cfg.PUBSUB_REDIS_DB or 0,
                username=cfg.PUBSUB_REDIS_USERNAME,
                password=cfg.PUBSUB_REDIS_PASSWORD,
                use_ssl=use_ssl,
            )
        case "sentinel":
            nodes = _parse_host_port_list(cfg.PUBSUB_REDIS_SENTINELS, env_name="PUBSUB_REDIS_SENTINELS")
            if not nodes:
                raise ValueError("PUBSUB_REDIS_MODE=sentinel requires non-empty PUBSUB_REDIS_SENTINELS")
            if not cfg.PUBSUB_REDIS_SENTINEL_SERVICE_NAME:
                raise ValueError("PUBSUB_REDIS_MODE=sentinel requires PUBSUB_REDIS_SENTINEL_SERVICE_NAME")
            return RedisConnectionSpec(
                mode="sentinel",
                sentinel_nodes=nodes,
                sentinel_service_name=cfg.PUBSUB_REDIS_SENTINEL_SERVICE_NAME,
                sentinel_username=cfg.PUBSUB_REDIS_SENTINEL_USERNAME,
                sentinel_password=cfg.PUBSUB_REDIS_SENTINEL_PASSWORD,
                sentinel_socket_timeout=cfg.PUBSUB_REDIS_SENTINEL_SOCKET_TIMEOUT,
                db=cfg.PUBSUB_REDIS_DB or 0,
                username=cfg.PUBSUB_REDIS_USERNAME,
                password=cfg.PUBSUB_REDIS_PASSWORD,
                use_ssl=use_ssl,
            )
        case "cluster":
            nodes = _parse_host_port_list(cfg.PUBSUB_REDIS_CLUSTERS, env_name="PUBSUB_REDIS_CLUSTERS")
            if not nodes:
                raise ValueError("PUBSUB_REDIS_MODE=cluster requires non-empty PUBSUB_REDIS_CLUSTERS")
            return RedisConnectionSpec(
                mode="cluster",
                cluster_nodes=nodes,
                username=cfg.PUBSUB_REDIS_USERNAME,
                password=cfg.PUBSUB_REDIS_PASSWORD,
                use_ssl=use_ssl,
            )
        case _:
            raise ValueError(f"Unknown PUBSUB_REDIS_MODE: {mode!r}")


def build_pubsub_spec(
    main_spec: RedisConnectionSpec,
    pubsub_config: PubSubConfigProtocol,
) -> RedisConnectionSpec:
    """Determine the Event Bus connection spec.

    Resolution:

    1. ``PUBSUB_REDIS_MODE`` set → build from structured ``PUBSUB_REDIS_*``
       fields (supports all three topologies, including Sentinel).
    2. Otherwise → return ``main_spec`` as-is so the caller can detect
       "pub/sub == main" and share a single client object. This is what
       gives the Event Bus the same Sentinel failover the main client has.
    """
    if pubsub_config.PUBSUB_REDIS_MODE:
        return _spec_from_pubsub_fields(pubsub_config)

    return main_spec
