# Clickzetta Integration Tests

## Running Tests

To run the Clickzetta integration tests, you need to set the following environment variables:

```bash
export CLICKZETTA_USERNAME=your_username
export CLICKZETTA_PASSWORD=your_password
export CLICKZETTA_INSTANCE=your_instance
export CLICKZETTA_SERVICE=api.clickzetta.com
export CLICKZETTA_WORKSPACE=your_workspace
export CLICKZETTA_VCLUSTER=your_vcluster
export CLICKZETTA_SCHEMA=dify
```

Then run the tests:

```bash
pytest api/tests/integration_tests/vdb/clickzetta/
```

## Security Note

Never commit credentials to the repository. Always use environment variables or secure credential management systems.
