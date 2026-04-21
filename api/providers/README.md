# Providers

This directory holds **optional workspace packages** that plug into Dify’s API core. Providers are responsible for implementing the interfaces and registering themselves to the API core. Provider mechanism allows building the software with selected set of providers so as to enhance the security and flexibility of distributions.

## Developing Providers

- [VDB Providers](vdb/README.md)

## Tests

Provider tests often live next to the package, e.g. `providers/<type>/<backend>/tests/unit_tests/`. Shared fixtures may live under `providers/` (e.g. `conftest.py`).

## Excluding Providers

In order to build with selected providers, use `--no-group vdb-all` and `--no-group trace-all` to disable default ones, then use `--group vdb-<provider>` and `--group trace-<provider>` to enable specific providers.
