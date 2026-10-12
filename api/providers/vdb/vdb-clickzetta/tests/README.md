# Clickzetta Integration Tests

## CI Integration Tests

Integration tests run in CI with a dedicated Clickzetta test instance. Configure these environment variables in that environment:

```bash
export CLICKZETTA_USERNAME=your_username
export CLICKZETTA_PASSWORD=your_password
export CLICKZETTA_INSTANCE=your_instance
export CLICKZETTA_SERVICE=api.clickzetta.com
export CLICKZETTA_WORKSPACE=your_workspace
export CLICKZETTA_VCLUSTER=your_vcluster
export CLICKZETTA_SCHEMA=dify
```

The CI invocation from the repository root is:

```bash
uv run --project api pytest api/providers/vdb/vdb-clickzetta/tests/integration_tests/
```

For local verification, run the provider unit tests:

```bash
uv run --project api pytest api/providers/vdb/vdb-clickzetta/tests/unit_tests/
```

## Credentials

Never commit credentials to the repository. Always use environment variables or secure credential management systems.
