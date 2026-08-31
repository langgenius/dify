from pathlib import Path

import yaml
from dify_plugin import Tool
from dify_plugin.core.utils.class_loader import load_single_subclass_from_source
from dify_plugin.entities.tool import ToolParameter

ROOT = Path(__file__).parents[1]


def test_registered_tool_schemas_are_renderable() -> None:
    provider = yaml.safe_load((ROOT / "provider/mrscraper.yaml").read_text())
    registered_tools = provider["tools"]

    assert "tools/mrscraper_run_existing_scraper.yaml" not in registered_tools
    assert {
        "tools/mrscraper_run_existing_scraper_ai_general.yaml",
        "tools/mrscraper_run_existing_scraper_ai_listing.yaml",
        "tools/mrscraper_run_existing_scraper_ai_map.yaml",
        "tools/mrscraper_run_existing_scraper_manual.yaml",
    }.issubset(registered_tools)

    for relative_path in registered_tools:
        schema = yaml.safe_load((ROOT / relative_path).read_text())
        for parameter in schema.get("parameters", []):
            ToolParameter.model_validate(parameter)


def test_split_existing_run_tools_expose_one_tool_subclass() -> None:
    tool_names = (
        "mrscraper_run_existing_scraper_ai_general",
        "mrscraper_run_existing_scraper_ai_listing",
        "mrscraper_run_existing_scraper_ai_map",
        "mrscraper_run_existing_scraper_manual",
    )

    for tool_name in tool_names:
        tool_class = load_single_subclass_from_source(
            module_name=f"test_{tool_name}",
            script_path=str(ROOT / f"tools/{tool_name}.py"),
            parent_type=Tool,
        )
        assert issubclass(tool_class, Tool)


def test_manual_json_fields_use_renderer_safe_text_inputs() -> None:
    schema = yaml.safe_load((ROOT / "tools/mrscraper_run_existing_scraper_manual.yaml").read_text())
    parameters = {parameter["name"]: parameter for parameter in schema["parameters"]}

    assert parameters["cookies"]["type"] == "string"
    assert parameters["paginator"]["type"] == "string"


def test_rendered_html_primary_options_follow_proxy_country() -> None:
    schema = yaml.safe_load((ROOT / "tools/mrscraper_fetch_rendered_html.yaml").read_text())
    parameters = schema["parameters"]
    parameter_names = [parameter["name"] for parameter in parameters]
    proxy_country_index = parameter_names.index("proxy_country")

    assert parameter_names[proxy_country_index + 1 : proxy_country_index + 5] == [
        "html",
        "markdown",
        "super_mode",
        "home_page",
    ]
    assert parameters[parameter_names.index("html")]["default"] is True
