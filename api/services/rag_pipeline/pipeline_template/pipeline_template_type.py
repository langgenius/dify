from enum import StrEnum


class PipelineTemplateType(StrEnum):
    REMOTE = "remote"
    BUILTIN = "builtin"
    CUSTOMIZED = "customized"
