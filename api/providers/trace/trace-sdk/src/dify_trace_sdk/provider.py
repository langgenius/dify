"""The interface every trace provider implements.

It is the lowest common denominator of the supported destinations: validate a
configuration, verify it against the destination, link to the destination's
project, and send one trace. Everything else (collecting data, retries,
credentials storage, tenancy) belongs to the Dify trace pipeline.
"""

from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar

from dify_trace_sdk.config import ProviderConfig
from dify_trace_sdk.egress import Egress
from dify_trace_sdk.model import Trace


@dataclass(frozen=True)
class ProviderCapabilities:
    """What a destination's mapping supports. These describe the adapter, not delivery health."""

    native_cost: bool
    trace_url: bool
    span_url: bool


@dataclass(frozen=True)
class SendResult:
    trace_id: str
    """The destination's identifier for the trace."""
    trace_url: str | None
    span_urls: Mapping[str, str]
    """Destination links keyed by ``Span.span_id``."""


class TraceProvider[ConfigT: ProviderConfig](ABC):
    """One trace destination.

    Instances are cheap and hold no connections between calls: the pipeline
    creates one per operation with the egress it must use.
    """

    id: ClassVar[str]
    config_model: ClassVar[type[ProviderConfig]]
    capabilities: ClassVar[ProviderCapabilities]

    def __init__(self, egress: Egress) -> None:
        self.egress = egress

    @abstractmethod
    def verify(self, config: ConfigT) -> ConfigT:
        """Check that the destination accepts this configuration.

        Return the configuration with derived fields resolved. Make read-only
        requests only; never create resources in the destination.

        Raises:
            VerificationError: The destination rejected or could not confirm the configuration.
        """

    @abstractmethod
    def project_url(self, config: ConfigT) -> str | None:
        """A link to the destination's project for this configuration. Performs no I/O."""

    @abstractmethod
    def send(self, config: ConfigT, trace: Trace) -> SendResult:
        """Deliver one trace unit and return once the destination acknowledged it.

        When ``trace.parent`` is set, attach the root under that span if the
        destination supports it; otherwise deliver the unit on its own.

        Raises:
            ExportRetryableError: Nothing was accepted; sending again is safe.
            ExportRejectedError: The destination refused the trace.
            ExportOutcomeUnknownError: The destination may have accepted part of the trace.
        """
