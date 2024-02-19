[English](./README.md) | [简体中文](./README_CN.md) | [日本語](./README_JA.md) | [Español](./README_ES.md) | [Français](./README_FR.md)


# Dify.ai local development tools


## Code Style Management - improving code quality

Ensure consistent code quality by setting up pre-commit hooks.

Consistent code quality streamline development by automatically enforcing code standards. This minimizes deviations and simplifies code review. It can seem strong, it is beneficial as it fosters a more efficient and cohesive workflow.

It's a proactive measure to catch issues early in the development cycle, saving time, and maintaining code quality.

### Setting up pre-commit

To install the pre-commit hooks, run:

```sh
# CAUTION: if you use one, make sure you are in your virtual environment

# install the pip package and git hook for pre-commit
make install_local_dev

# Optional: Link to the repositories pre-commit script (means the project can have centralised pre-commit logic)
ln -s pre-commit .git/hooks/pre-commit
```

### What is checked

Our pre-commit configuration enforces checks for whitespaces, EOF fixers, and syntax validation for various file formats. It also checks for potential security issues like exposed private keys.

### Hooks

We utilize hooks from `pre-commit-hooks` for general checks, alongside `ruff-pre-commit` for Python-specific linting.

Refer to `.pre-commit-config.yaml` for detailed hook configurations.

## Testing

Maintain code integrity with our testing suite:

### Integration Tests

Execute model API integration tests:

```sh
pytest api/tests/integration_tests/
```

### Unit Tests

Assess tool functionality:

```sh
pytest api/tests/unit_tests/
```
