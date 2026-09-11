import pytest

from core.network_access.client_ip import NetworkAccessClientIPUnavailableError, resolve_network_access_client_ip

TRUSTED = "172.18.0.0/16,10.0.0.0/8,2400:cb00::/32"


@pytest.mark.parametrize("config", ["", TRUSTED])
def test_untrusted_socket_ignores_all_forwarding_headers(config: str):
    assert (
        resolve_network_access_client_ip(
            {
                "REMOTE_ADDR": "203.0.113.42",
                "HTTP_X_FORWARDED_FOR": "192.0.2.1, invalid",
                "HTTP_CF_CONNECTING_IP": "192.0.2.1",
                "HTTP_X_REAL_IP": "192.0.2.1",
            },
            config,
        )
        == "203.0.113.42"
    )


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("203.0.113.42", "203.0.113.42"),
        ("192.0.2.1, 203.0.113.42, 10.2.3.4", "203.0.113.42"),
        ("2001:db8::1234, 2400:cb00::1, 10.2.3.4", "2001:db8::1234"),
        ("::ffff:203.0.113.42, ::ffff:10.2.3.4", "203.0.113.42"),
        (" 2001:0db8:0:0::1234 , 10.2.3.4 ", "2001:db8::1234"),
    ],
)
def test_trusted_chain_strips_only_rightmost_trusted_hops(header: str, expected: str):
    assert (
        resolve_network_access_client_ip({"REMOTE_ADDR": "172.18.0.2", "HTTP_X_FORWARDED_FOR": header}, TRUSTED)
        == expected
    )


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "203.0.113.42,",
        ",203.0.113.42",
        "unknown",
        "203.0.113.42:443",
        "[2001:db8::1]",
        "fe80::1%eth0",
        "192.0.2.1,invalid",
        "10.1.2.3",
        "192.0.2.1," * 33,
        "x" * 2049,
    ],
)
def test_trusted_peer_rejects_missing_invalid_or_all_trusted_chains(header: object):
    with pytest.raises(NetworkAccessClientIPUnavailableError):
        resolve_network_access_client_ip({"REMOTE_ADDR": "172.18.0.2", "HTTP_X_FORWARDED_FOR": header}, TRUSTED)


@pytest.mark.parametrize("peer", [None, "", "unknown", "[::1]", "203.0.113.42:5000", "fe80::1%eth0", 1])
def test_invalid_socket_peer_is_unavailable(peer: object):
    with pytest.raises(NetworkAccessClientIPUnavailableError):
        resolve_network_access_client_ip({"REMOTE_ADDR": peer}, TRUSTED)


def test_proxy_fix_cannot_make_untrusted_origin_appear_trusted():
    environ = {
        "REMOTE_ADDR": "172.18.0.2",
        "werkzeug.proxy_fix.orig": {"REMOTE_ADDR": "203.0.113.42"},
        "HTTP_X_FORWARDED_FOR": "192.0.2.1",
    }
    assert resolve_network_access_client_ip(environ, TRUSTED) == "203.0.113.42"


def test_proxy_fix_preserves_trusted_socket_even_after_remote_addr_rewrite():
    environ = {
        "REMOTE_ADDR": "192.0.2.1",
        "werkzeug.proxy_fix.orig": {"REMOTE_ADDR": "172.18.0.2"},
        "HTTP_X_FORWARDED_FOR": "192.0.2.1, 203.0.113.42",
    }
    assert resolve_network_access_client_ip(environ, TRUSTED) == "203.0.113.42"


@pytest.mark.parametrize("original", ["invalid", {}, {"REMOTE_ADDR": None}])
def test_malformed_proxy_fix_original_is_unavailable(original: object):
    with pytest.raises(NetworkAccessClientIPUnavailableError):
        resolve_network_access_client_ip({"REMOTE_ADDR": "203.0.113.42", "werkzeug.proxy_fix.orig": original}, TRUSTED)


@pytest.mark.parametrize(
    "config", ["not-a-cidr", "172.18.0.1/16", "172.18.0.0/16,", "fe80::%eth0/64", "10.0.0.0/8," * 257]
)
def test_invalid_proxy_configuration_is_unavailable(config: str):
    with pytest.raises(NetworkAccessClientIPUnavailableError):
        resolve_network_access_client_ip({"REMOTE_ADDR": "203.0.113.42"}, config)


def test_mapped_socket_and_proxy_cidr_match_ipv4():
    assert (
        resolve_network_access_client_ip(
            {"REMOTE_ADDR": "::ffff:172.18.0.2", "HTTP_X_FORWARDED_FOR": "::ffff:203.0.113.42"},
            "::ffff:172.18.0.0/112",
        )
        == "203.0.113.42"
    )
