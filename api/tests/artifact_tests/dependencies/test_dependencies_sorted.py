from typing import Any

import toml

ALL_DEPENDENCY_GROUP_NAMES = [
    # default main group
    "",
    # required groups
    "indirect",
    "storage",
    "tools",
    "vdb",
    # optional groups
    "dev",
    "lint",
]


def load_api_poetry_configs() -> dict[str, Any]:
    pyproject_toml = toml.load("api/pyproject.toml")
    return pyproject_toml.get("tool").get("poetry")


def load_dependency_groups() -> dict[str, dict[str, dict[str, Any]]]:
    poetry_configs = load_api_poetry_configs()
    group_name_to_dependencies = {
        group_name: (poetry_configs.get("group").get(group_name) if group_name else poetry_configs).get("dependencies")
        for group_name in ALL_DEPENDENCY_GROUP_NAMES
    }
    return group_name_to_dependencies


def test_group_dependencies_sorted():
    for group_name, dependencies in load_dependency_groups().items():
        dependency_names = list(dependencies.keys())
        expected_dependency_names = sorted(set(dependency_names))
        section = f"tool.poetry.group.{group_name}.dependencies" if group_name else "tool.poetry.dependencies"
        assert expected_dependency_names == dependency_names, (
            f"Dependencies in group {group_name} are not sorted. "
            f"Check and fix [{section}] section in pyproject.toml file"
        )


def test_group_dependencies_version_operator():
    for group_name, dependencies in load_dependency_groups().items():
        for dependency_name, specification in dependencies.items():
            version_spec = specification if isinstance(specification, str) else specification.get("version")
            assert not version_spec.startswith("^"), (
                f"'^' is not allowed in dependency version," f" but found in '{dependency_name} = {version_spec}'"
            )


def test_duplicated_dependency_crossing_groups():
    all_dependency_names: list[str] = []
    for dependencies in load_dependency_groups().values():
        dependency_names = list(dependencies.keys())
        all_dependency_names.extend(dependency_names)
    expected_all_dependency_names = set(all_dependency_names)
    assert sorted(expected_all_dependency_names) == sorted(
        all_dependency_names
    ), "Duplicated dependencies crossing groups are found"
