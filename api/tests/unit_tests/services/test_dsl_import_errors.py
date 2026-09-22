from services.dsl_import_errors import missing_app_section_error


def test_missing_app_section_names_the_keys_that_were_present() -> None:
    error = missing_app_section_error(["meta", "nodes", "edges"])
    assert error.startswith("Missing app data in YAML content.")
    assert "found: meta, nodes, edges" in error
