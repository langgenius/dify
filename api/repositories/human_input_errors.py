"""Persistence conflicts for human input form submission."""

from enums.human_input import HumanInputFormStatus


class FormAlreadyHandledError(Exception):
    def __init__(self, status: HumanInputFormStatus):
        self.status = status
        super().__init__(f"Form is no longer waiting: {status}")
