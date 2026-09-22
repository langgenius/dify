def missing_app_section_error(top_level_keys: list[str]) -> str:
    """Explain a YAML that has no top-level ``app`` mapping.

    The found keys are the caller's actual document, so a sketch of nodes is
    not reported as a blank import failure.
    """
    found = ", ".join(key for key in top_level_keys if key != "app")
    if len(found) > 80:
        found = found[:80].rstrip(", ") + "…"
    return (
        "Missing app data in YAML content. "
        "Not a valid Dify app DSL: the top-level 'app' section is required "
        f"(found: {found or 'none'})."
    )
