"""
Constants for virtual environment providers.

Centralizes timeout and other configuration values used across different sandbox providers
(E2B, SSH, Docker) to ensure consistency and ease of maintenance.
"""

# Command execution timeout in seconds (5 hours)
# Used by providers to limit how long a single command can run
COMMAND_EXECUTION_TIMEOUT_SECONDS = 5 * 60 * 60  # 18000 seconds
