#!/bin/bash
set -e

# IRIS configuration flag file
IRIS_CONFIG_DONE="/opt/iris/.iris-configured"

# Function to configure IRIS
configure_iris() {
    echo "Configuring IRIS for first-time setup..."

    # Wait for IRIS to be fully started
    sleep 5

    # Execute the initialization script
    iris session IRIS < /iris-init.script

    # Mark configuration as done
    touch "$IRIS_CONFIG_DONE"

    echo "IRIS configuration completed."
}

# Start IRIS in background for initial configuration if not already configured
if [ ! -f "$IRIS_CONFIG_DONE" ]; then
    echo "First-time IRIS setup detected. Starting IRIS for configuration..."

    # Start IRIS
    iris start IRIS

    # Configure IRIS
    configure_iris

    # Stop IRIS
    iris stop IRIS quietly
fi

# Run the original IRIS entrypoint
exec /iris-main "$@"
