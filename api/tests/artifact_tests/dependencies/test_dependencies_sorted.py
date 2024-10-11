from typing import Any

import toml


def load_api_poetry_configs() -> dict[str, Any]:
    pyproject_toml = toml.load("api/pyproject.toml")
    return pyproject_toml["tool"]["poetry"]


def load_all_dependency_groups() -> dict[str, dict[str, dict[str, Any]]]:
    configs = load_api_poetry_configs()
    configs_by_group = {"main": configs}
    for group_name in configs["group"]:
        configs_by_group[group_name] = configs["group"][group_name]
    dependencies_by_group = {group_name: base["dependencies"] for group_name, base in configs_by_group.items()}
    return dependencies_by_group


def test_group_dependencies_sorted():
    for group_name, dependencies in load_all_dependency_groups().items():
        dependency_names = list(dependencies.keys())
        expected_dependency_names = sorted(set(dependency_names))
        section = f"tool.poetry.group.{group_name}.dependencies" if group_name else "tool.poetry.dependencies"
        assert expected_dependency_names == dependency_names, (
            f"Dependencies in group {group_name} are not sorted. "
            f"Check and fix [{section}] section in pyproject.toml file"
        )


def test_group_dependencies_version_operator():
    for group_name, dependencies in load_all_dependency_groups().items():
        for dependency_name, specification in dependencies.items():
            version_spec = specification if isinstance(specification, str) else specification["version"]
            assert not version_spec.startswith("^"), (
                f"Please replace '{dependency_name} = {version_spec}' with '{dependency_name} = ~{version_spec[1:]}' "
                f"'^' operator is too wide and not allowed in the version specification."
            )


def test_duplicated_dependency_crossing_groups():
    all_dependency_names: list[str] = []
    for dependencies in load_all_dependency_groups().values():
        dependency_names = list(dependencies.keys())
        all_dependency_names.extend(dependency_names)
    expected_all_dependency_names = set(all_dependency_names)
    assert sorted(expected_all_dependency_names) == sorted(
        all_dependency_names
    ), "Duplicated dependencies crossing groups are found"
