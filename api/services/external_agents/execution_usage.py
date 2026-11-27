"""Consumer-owned reads of proven usage for one frozen external execution.

Usage is observational: missing evidence never means zero and cannot change a
business result, submit work, or authorize another execution.
"""

from datetime import datetime
from typing import Protocol

from .runtime_contracts import RuntimeScope


class ExternalExecutionUsageQuery(Protocol):
    def total_tokens(self, scope: RuntimeScope, invocation_id: str, *, now: datetime) -> int | None:
        """Read the admitted owner's retry prefix through this exact Invocation.

        Preconditions: scope is the admitted execution owner and now is the
        observation time. Reconstruct its complete persisted identity, validate
        every attempt and retry link, and count only actual business dispatches.
        Different connection revisions may belong to the same legal retry chain.

        Postconditions: return a nonnegative sum only when every dispatched
        attempt has a proven call-total summary; a reported zero remains zero.
        None means no dispatch or unavailable/incomplete ownership, retention,
        retry-chain or usage evidence. Never sum Trace steps or infer zero from
        a missing record. Reads have no business or provider side effects.
        Infrastructure failures may raise; callers must preserve the business
        result and treat a failed read as unknown usage.
        """
        ...
