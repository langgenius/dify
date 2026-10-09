"""Persistence conflicts for human input form submission."""

from core.workflow.nodes.human_input.enums import HumanInputFormStatus


class FormAlreadyHandledError(Exception):
    def __init__(self, status: HumanInputFormStatus):
        self.status = status
        super().__init__(f"Form is no longer waiting: {status}")
