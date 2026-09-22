"""Unit tests for services.dify_builder.agent.user_supplied.

These are the shared "did the user actually write this, or did the model
invent it" primitives (ESQ1-302 / S5b / F1, F2): they underpin the
requirements-analysis scrub in Task 1 and later tasks' checks on http-request
URLs and headers. Pure functions, no I/O.
"""

import json

from services.dify_builder.agent import user_supplied as us


def test_url_hosts_extracts_lowercase_hostnames_from_prose():
    text = "Call https://API.Example.com/v1 and also http://other.example.org:8080/x please."
    assert us.url_hosts(text) == {"api.example.com", "other.example.org"}


def test_url_hosts_empty_set_when_no_urls_present():
    assert us.url_hosts("no urls in this goal at all") == set()


def test_url_hosts_empty_text_is_empty_set():
    assert us.url_hosts("") == set()


def test_is_user_supplied_url_true_when_host_matches_case_insensitively():
    trusted = "the goal mentions https://render.acme.internal/v2 as the target"
    assert us.is_user_supplied_url("https://Render.Acme.Internal/v2/pptx", trusted) is True


def test_is_user_supplied_url_false_when_host_absent_from_trusted_text():
    assert us.is_user_supplied_url("https://api.pptrender.io/v1/render", "no url here") is False


def test_is_user_supplied_url_empty_url_is_false():
    assert us.is_user_supplied_url("", "https://anything.example.com") is False


def test_is_user_supplied_url_dify_template_is_always_true():
    # A template reference is a variable, not a literal -- it can't be "invented".
    assert us.is_user_supplied_url("{{#node1.node5_url#}}", "goal has no url at all") is True


# --- Final review F1: only a template in the HOST position exempts a URL ---


def test_is_user_supplied_url_false_when_a_templated_query_hides_an_invented_host():
    url = "https://api.pptrender.io/v1/render?topic={{#node1.topic#}}"
    assert us.is_user_supplied_url(url, "goal has no url at all") is False


def test_is_user_supplied_url_false_when_a_templated_path_hides_an_invented_host():
    url = "https://api.pptrender.io/v1/{{#node1.topic#}}/render"
    assert us.is_user_supplied_url(url, "goal has no url at all") is False


def test_is_user_supplied_url_true_for_a_template_in_the_host_position():
    assert us.is_user_supplied_url("{{#s.h_url#}}/v1/render", "goal has no url at all") is True
    assert us.is_user_supplied_url("https://{{#s.host#}}/v1", "goal has no url at all") is True


def test_is_user_supplied_url_true_for_a_templated_path_on_a_host_the_user_gave():
    url = "https://api.pptrender.io/v1/{{#node1.topic#}}/render"
    assert us.is_user_supplied_url(url, "render via https://api.pptrender.io/v1") is True


def test_credential_placeholder_re_matches_known_placeholder_shapes():
    for token in (
        "YOUR_API_KEY",
        "YOURKEY",
        "your-token",
        "API_KEY_HERE",
        "TOKEN_HERE",
        "<api-key>",
        "REPLACE_ME",
        "CHANGE-ME",
        "xxxxxxxx",
        "******",
    ):
        assert us.CREDENTIAL_PLACEHOLDER_RE.search(token), token


def test_credential_placeholder_re_does_not_match_a_real_looking_secret():
    assert us.CREDENTIAL_PLACEHOLDER_RE.search("sk-live-abc123") is None


def test_is_user_supplied_secret_true_when_bearer_stripped_value_is_literal():
    assert us.is_user_supplied_secret("Bearer sk-live-abc123", "the key is sk-live-abc123") is True


def test_is_user_supplied_secret_strips_basic_and_token_prefixes_case_insensitively():
    assert us.is_user_supplied_secret("basic sk-live-abc123", "sk-live-abc123") is True
    assert us.is_user_supplied_secret("TOKEN sk-live-abc123", "sk-live-abc123") is True


def test_is_user_supplied_secret_false_for_placeholder_even_with_bearer_prefix():
    assert us.is_user_supplied_secret("Bearer YOUR_API_KEY", "anything at all") is False


def test_is_user_supplied_secret_false_for_empty_or_prefix_only_value():
    assert us.is_user_supplied_secret("", "anything") is False
    assert us.is_user_supplied_secret("Bearer ", "anything") is False


def test_is_user_supplied_secret_true_for_dify_template_reference():
    assert us.is_user_supplied_secret("{{#node1.api_key#}}", "goal text with nothing matching") is True


def test_is_user_supplied_secret_false_when_remainder_not_in_trusted_text():
    assert us.is_user_supplied_secret("sk-live-abc123", "the goal names nothing like that") is False


def test_trusted_text_for_combines_goal_and_requirements_json():
    out = us.trusted_text_for("build a thing", {"a": 1, "b": "x"})
    assert out == "build a thing\n" + json.dumps({"a": 1, "b": "x"}, ensure_ascii=False)


def test_trusted_text_for_empty_requirements():
    assert us.trusted_text_for("goal only", {}) == "goal only\n{}"


# --- Fix round 1: is_credential_key decides on the key's LAST segment -----


def test_is_credential_key_true_for_real_credential_keys():
    for key in ("api_key", "apiKey", "x-api-key", "access_token", "Authorization"):
        assert us.is_credential_key(key), key


def test_is_credential_key_false_for_lookalike_keys():
    for key in ("password_policy", "token_limit", "session_token_expiry", "max_tokens", "key_points"):
        assert not us.is_credential_key(key), key


def test_is_credential_key_false_for_empty_key():
    assert us.is_credential_key("") is False


# --- Task 3 review fix round 1: is_credential_key moved into core, plus a
# params-only sibling that also treats a bare "key" as a credential --------


def test_is_credential_key_still_importable_after_moving_into_core():
    """The pure logic now lives in core.dify_builder.credentials (core must
    not import services); user_supplied re-exports it so this module's own
    API is unchanged."""
    from core.dify_builder.credentials import is_credential_key as core_is_credential_key

    assert us.is_credential_key is core_is_credential_key


def test_is_credential_param_key_also_treats_a_bare_key_as_a_credential():
    assert us.is_credential_param_key("key")
    assert us.is_credential_param_key("KEY")
    assert us.is_credential_param_key("  key  ")


def test_is_credential_param_key_still_excludes_lookalikes():
    for key in ("cache_key", "key_points", "password_policy", "token_limit"):
        assert not us.is_credential_param_key(key), key


def test_is_credential_param_key_still_true_for_ordinary_credential_keys():
    for key in ("api_key", "apiKey", "x-api-key", "access_token", "Authorization"):
        assert us.is_credential_param_key(key), key


# --- Fix round 1: url_hosts stops at the first non-URL character ----------


def test_url_hosts_drops_trailing_sentence_punctuation():
    text = "… to https://render.acme.internal. Thanks."
    assert us.url_hosts(text) == {"render.acme.internal"}


def test_url_hosts_stops_before_cjk_text():
    text = "请调用https://api.x.com接口完成任务"
    assert us.url_hosts(text) == {"api.x.com"}


def test_is_user_supplied_url_true_with_url_at_end_of_sentence():
    trusted = "… to https://render.acme.internal. Thanks."
    assert us.is_user_supplied_url("https://render.acme.internal/v2/pptx", trusted) is True


def test_url_hosts_lowercases_host_with_port():
    assert us.url_hosts("https://API.Example.com:8443/x") == {"api.example.com"}


# --- Fix round 1: strip_auth_scheme is a shared, exported helper ----------


def test_strip_auth_scheme_strips_known_prefixes_case_insensitively():
    assert us.strip_auth_scheme("Bearer sk-live-abc123") == "sk-live-abc123"
    assert us.strip_auth_scheme("basic sk-live-abc123") == "sk-live-abc123"
    assert us.strip_auth_scheme("TOKEN sk-live-abc123") == "sk-live-abc123"


def test_strip_auth_scheme_leaves_a_plain_value_unchanged():
    assert us.strip_auth_scheme("sk-live-abc123") == "sk-live-abc123"


def test_strip_auth_scheme_handles_empty_value():
    assert us.strip_auth_scheme("") == ""
