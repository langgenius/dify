from libs.url_utils import github_blob_to_raw_url


def test_github_blob_to_raw_url_normalizes_capitalized_host() -> None:
    # URL host names are case-insensitive (RFC 3986); a capitalized GitHub host
    # must resolve to the same raw file URL as the lowercase spelling.
    expected = "https://raw.githubusercontent.com/acme/app/main/dsl.yml"
    assert github_blob_to_raw_url("https://GitHub.com/acme/app/blob/main/dsl.yml") == expected
    assert github_blob_to_raw_url("https://GITHUB.COM/acme/app/blob/main/dsl.yml") == expected
    assert github_blob_to_raw_url("https://github.COM/acme/app/blob/main/dsl.yml") == expected


def test_github_blob_to_raw_url_lowercase_host_is_unchanged() -> None:
    assert github_blob_to_raw_url("https://github.com/acme/app/blob/main/dsl.yml") == (
        "https://raw.githubusercontent.com/acme/app/main/dsl.yml"
    )


def test_github_blob_to_raw_url_preserves_query_and_fragment() -> None:
    # Regression: the conversion keeps the query string and fragment intact.
    assert github_blob_to_raw_url("https://github.com/acme/app/blob/main/dsl.yml?ref=main#L12") == (
        "https://raw.githubusercontent.com/acme/app/main/dsl.yml?ref=main#L12"
    )


def test_github_blob_to_raw_url_leaves_other_urls_untouched() -> None:
    non_github = "https://gitlab.com/acme/app/blob/main/dsl.yml"
    assert github_blob_to_raw_url(non_github) == non_github
    subdomain = "https://GIST.GITHUB.COM/acme/app/blob/main/dsl.yml"
    assert github_blob_to_raw_url(subdomain) == subdomain
    tree_path = "https://github.com/acme/app/tree/main/dsl.yml"
    assert github_blob_to_raw_url(tree_path) == tree_path
    http_scheme = "http://github.com/acme/app/blob/main/dsl.yml"
    assert github_blob_to_raw_url(http_scheme) == http_scheme
