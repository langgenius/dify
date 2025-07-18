import logging
import re
from collections.abc import Sequence
from typing import Any

from core.tools.entities.tool_entities import CredentialType

logger = logging.getLogger(__name__)


def generate_provider_name(
    providers: Sequence[Any], 
    credential_type: CredentialType, 
    fallback_context: str = "provider"
) -> str:
    try:
        default_pattern = f"{credential_type.get_name()}"

        pattern = rf"^{re.escape(default_pattern)}\s+(\d+)$"
        numbers = []

        for provider in providers:
            if provider.name:
                match = re.match(pattern, provider.name.strip())
                if match:
                    numbers.append(int(match.group(1)))

        if not numbers:
            return f"{default_pattern} 1"

        max_number = max(numbers)
        return f"{default_pattern} {max_number + 1}"
    except Exception as e:
        logger.warning(f"Error generating next provider name for {fallback_context}: {str(e)}")
        return f"{credential_type.get_name()} 1" 