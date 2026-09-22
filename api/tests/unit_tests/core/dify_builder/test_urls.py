"""``core.dify_builder.urls``: the one definition of a URL's HOST position,
reading a Dify template (``{{#node.var#}}``) as one opaque unit -- shared by
the grounding side (services) and ``endpoint_variable_names`` (core) so the
two agree on which template is the endpoint and which is ordinary data."""

from core.dify_builder import urls


def test_split_origin_keeps_the_path_and_templated_query_verbatim():
    parts = urls.split_origin("https://api.pptrender.io/v1/render?topic={{#node1.topic#}}")

    assert parts == urls.UrlOrigin(
        origin="https://api.pptrender.io",
        host="api.pptrender.io",
        rest="/v1/render?topic={{#node1.topic#}}",
    )


def test_split_origin_keeps_a_templated_path_verbatim():
    parts = urls.split_origin("https://api.pptrender.io/v1/{{#node1.topic#}}/render")

    assert parts is not None
    assert parts.origin == "https://api.pptrender.io"
    assert parts.rest == "/v1/{{#node1.topic#}}/render"


def test_split_origin_reads_a_template_in_the_host_as_one_unit():
    # ``urlsplit`` would read the template's ``#`` as the start of a fragment.
    parts = urls.split_origin("https://{{#s.host#}}/v1")

    assert parts is not None
    assert parts.host == "{{#s.host#}}"
    assert parts.rest == "/v1"


def test_split_origin_drops_userinfo_and_port_from_the_host():
    parts = urls.split_origin("  https://user:pw@API.Example.com:8443/x  ")

    assert parts is not None
    assert parts.origin == "https://user:pw@API.Example.com:8443"
    assert parts.host == "API.Example.com"  # as written; callers lowercase
    assert parts.rest == "/x"


def test_split_origin_none_without_a_scheme():
    assert urls.split_origin("{{#s.h_url#}}/v1/render") is None
    assert urls.split_origin("api.pptrender.io/v1") is None
    assert urls.split_origin("") is None


def test_host_is_templated_for_a_leading_template_or_a_template_in_the_host():
    assert urls.host_is_templated("{{#s.h_url#}}/v1/render")
    assert urls.host_is_templated("  {{#s.h_url#}}")
    assert urls.host_is_templated("https://{{#s.host#}}/v1")
    assert urls.host_is_templated("https://api.{{#s.env#}}.acme.com/v1")


def test_host_is_templated_false_for_a_template_only_in_the_path_or_query():
    assert not urls.host_is_templated("https://api.pptrender.io/v1/render?topic={{#node1.topic#}}")
    assert not urls.host_is_templated("https://api.pptrender.io/v1/{{#node1.topic#}}/render")
    assert not urls.host_is_templated("https://api.pptrender.io/v1")
    assert not urls.host_is_templated("")
