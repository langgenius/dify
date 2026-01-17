"""
Constants for Workflow Generator.
Replaces magic strings throughout the codebase.
"""

# Placeholder value for LLM to indicate "needs user input"
PLACEHOLDER_VALUE = "__PLACEHOLDER__"

# Retry configuration
MAX_RETRIES = 3
INITIAL_RETRY_DELAY_MS = 1000

# Temperature settings for retry strategies
TEMPERATURE_DEFAULT = 0.7
TEMPERATURE_HIGH = 0.9
TEMPERATURE_LOW = 0.3

# Intent types
INTENT_GENERATE = "generate"
INTENT_OFF_TOPIC = "off_topic"
INTENT_ERROR = "error"

# Node types that require model configuration
MODEL_REQUIRED_NODE_TYPES = frozenset({"llm", "question-classifier", "parameter-extractor"})

# Stability warning messages (i18n keys in the future)
STABILITY_WARNING_EN = "The generated workflow may require debugging."
STABILITY_WARNING_ZH = "生成的 Workflow 可能需要调试。"
