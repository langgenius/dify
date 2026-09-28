import enum


class PluginCredentialType(enum.Enum):
    MODEL = 0  # must be 0 for API contract compatibility
    TOOL = 1  # must be 1 for API contract compatibility

    def to_number(self):
        return self.value
