#!/bin/bash
set -e

# Function to configure IRIS (idempotent - safe to run multiple times)
configure_iris() {
    echo "Running IRIS initialization..."

    # Wait for IRIS to be fully started
    sleep 5

    # Execute the initialization script
    iris session IRIS < /iris-init.script

    echo "IRIS initialization completed."
}

# Start IRIS for initialization
echo "Starting IRIS for initialization..."
iris start IRIS

# Configure IRIS (idempotent)
configure_iris

# Stop IRIS
iris stop IRIS quietly

# Run the original IRIS entrypoint
exec /iris-main "$@"
