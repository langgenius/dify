# pyright: reportMissingImports=false

from collections.abc import Mapping

from dify_plugin import Plugin


class AgentPayMCPPaymentsPlugin(Plugin):
    """Plugin entrypoint for AgentPay MCP Payments."""

    def _invoke(self, payload: Mapping[str, object]) -> Mapping[str, object]:
        return payload


if __name__ == "__main__":
    AgentPayMCPPaymentsPlugin().run()
