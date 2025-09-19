import logging
import re
from collections.abc import Sequence
from typing import Any

from core.tools.entities.tool_entities import CredentialType

logger = logging.getLogger(__name__)


def generate_provider_name(
    providers: Sequence[Any], credential_type: CredentialType, fallback_context: str = "provider"
) -> str:
    try:
        return generate_incremental_name(
            [provider.name for provider in providers],
            f"{credential_type.get_name()}",
        )
    except Exception as e:
        logger.warning("Error generating next provider name for %r: %r", fallback_context, e)
        return f"{credential_type.get_name()} 1"


def generate_incremental_name(
    names: Sequence[str],
    default_pattern: str,
) -> str:
    pattern = rf"^{re.escape(default_pattern)}\s+(\d+)$"
    numbers = []

    for name in names:
        if not name:
            continue
        match = re.match(pattern, name.strip())
        if match:
            numbers.append(int(match.group(1)))

    if not numbers:
        return f"{default_pattern} 1"

    max_number = max(numbers)
    return f"{default_pattern} {max_number + 1}"
