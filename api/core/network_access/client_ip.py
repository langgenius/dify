"""Resolve a preview IP from a verified immediate peer and a strict proxy chain.

This is intentionally independent of the historical login-IP helper. Deployers
must configure the same trusted proxy boundary as the data-plane Gateway. An
edge proxy must sanitize X-Forwarded-For or append its verified immediate peer;
an untrusted caller cannot choose its IP merely by supplying forwarding headers.
"""

import ipaddress
from collections.abc import Mapping
from functools import lru_cache

type IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
type IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network

MAX_PROXY_HOPS = 32
MAX_FORWARDED_HEADER_LENGTH = 2048


class NetworkAccessClientIPUnavailableError(ValueError):
    """A reliable current client address cannot be determined."""


def _address(value: object) -> IPAddress:
    if not isinstance(value, str) or not value.strip() or "%" in value:
        raise NetworkAccessClientIPUnavailableError("current client IP is unavailable")
    try:
        address = ipaddress.ip_address(value.strip())
    except ValueError as exc:
        raise NetworkAccessClientIPUnavailableError("current client IP is unavailable") from exc
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


@lru_cache(maxsize=16)
def _trusted_networks(config: str) -> tuple[IPNetwork, ...]:
    if not config.strip():
        return ()
    entries = config.split(",")
    if len(entries) > 256:
        raise NetworkAccessClientIPUnavailableError("invalid network-access proxy configuration")
    networks: list[IPNetwork] = []
    for entry in entries:
        try:
            # Prefixes are explicit; reject host bits, scoped addresses and
            # empty entries rather than broadening a malformed trust boundary.
            if not entry.strip() or "%" in entry or "/" not in entry:
                raise ValueError("expected a proxy CIDR")
            network = ipaddress.ip_network(entry.strip(), strict=True)
            if isinstance(network, ipaddress.IPv6Network) and network.network_address.ipv4_mapped is not None:
                if network.prefixlen < 96:
                    raise ValueError("invalid mapped proxy CIDR")
                network = ipaddress.IPv4Network((network.network_address.ipv4_mapped, network.prefixlen - 96))
        except ValueError as exc:
            raise NetworkAccessClientIPUnavailableError("invalid network-access proxy configuration") from exc
        networks.append(network)
    return tuple(networks)


def resolve_network_access_client_ip(environ: Mapping[str, object], trusted_proxy_cidrs: str) -> str:
    """Return the first non-trusted hop, never a browser-supplied IP argument.

    If the actual socket peer is not trusted (including an empty trust list),
    ignore all forwarding headers. If it is trusted, require a complete, bounded
    XFF chain and strip trusted hops from the right. Invalid or all-trusted chains
    are unavailable rather than silently returning a proxy's address. Preserve
    the original peer when Werkzeug ProxyFix has rewritten REMOTE_ADDR.
    """
    original = environ.get("werkzeug.proxy_fix.orig")
    if original is not None:
        if not isinstance(original, Mapping):
            raise NetworkAccessClientIPUnavailableError("current client IP is unavailable")
        peer_value = original.get("REMOTE_ADDR")
    else:
        peer_value = environ.get("REMOTE_ADDR")
    peer = _address(peer_value)
    networks = _trusted_networks(trusted_proxy_cidrs)

    def trusted(address: IPAddress) -> bool:
        return any(address.version == network.version and address in network for network in networks)

    if not trusted(peer):
        return str(peer)
    header = environ.get("HTTP_X_FORWARDED_FOR")
    if not isinstance(header, str) or len(header) > MAX_FORWARDED_HEADER_LENGTH:
        raise NetworkAccessClientIPUnavailableError("current client IP is unavailable")
    values = header.split(",")
    if len(values) > MAX_PROXY_HOPS:
        raise NetworkAccessClientIPUnavailableError("current client IP is unavailable")
    chain = [_address(value) for value in values]
    for address in reversed(chain):
        if not trusted(address):
            return str(address)
    raise NetworkAccessClientIPUnavailableError("current client IP is unavailable")
