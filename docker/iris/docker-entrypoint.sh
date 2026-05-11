#!/bin/bash
set -e

# IRIS configuration flag file (stored in durable directory to persist with data)
IRIS_CONFIG_DONE="/durable/.iris-configured"

# Function to wait for IRIS to be ready
wait_for_iris() {
    echo "Waiting for IRIS to be ready..."
    local max_attempts=30
    local attempt=1
    while [ "$attempt" -le "$max_attempts" ]; do
        if iris qlist IRIS 2>/dev/null | grep -q "running"; then
            echo "IRIS is ready."
            return 0
        fi
        echo "Attempt $attempt/$max_attempts: IRIS not ready yet, waiting..."
        sleep 2
        attempt=$((attempt + 1))
    done
    echo "ERROR: IRIS failed to start within expected time." >&2
    return 1
}

# Function to configure IRIS
configure_iris() {
    echo "Configuring IRIS for first-time setup..."

    # Wait for IRIS to be fully started
    wait_for_iris

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
