from dataclasses import dataclass

from configs import dify_config


@dataclass(frozen=True)
class CodeNodeLimits:
    max_string_length: int | None = None
    max_number: int | float | None = None
    min_number: int | float | None = None
    max_precision: int | None = None
    max_depth: int | None = None
    max_number_array_length: int | None = None
    max_string_array_length: int | None = None
    max_object_array_length: int | None = None


@dataclass(frozen=True)
class ResolvedCodeNodeLimits:
    max_string_length: int
    max_number: int | float
    min_number: int | float
    max_precision: int
    max_depth: int
    max_number_array_length: int
    max_string_array_length: int
    max_object_array_length: int


def resolve_code_node_limits(overrides: CodeNodeLimits | None) -> ResolvedCodeNodeLimits:
    limits = overrides or CodeNodeLimits()
    return ResolvedCodeNodeLimits(
        max_string_length=dify_config.CODE_MAX_STRING_LENGTH
        if limits.max_string_length is None
        else limits.max_string_length,
        max_number=dify_config.CODE_MAX_NUMBER if limits.max_number is None else limits.max_number,
        min_number=dify_config.CODE_MIN_NUMBER if limits.min_number is None else limits.min_number,
        max_precision=dify_config.CODE_MAX_PRECISION if limits.max_precision is None else limits.max_precision,
        max_depth=dify_config.CODE_MAX_DEPTH if limits.max_depth is None else limits.max_depth,
        max_number_array_length=dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH
        if limits.max_number_array_length is None
        else limits.max_number_array_length,
        max_string_array_length=dify_config.CODE_MAX_STRING_ARRAY_LENGTH
        if limits.max_string_array_length is None
        else limits.max_string_array_length,
        max_object_array_length=dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH
        if limits.max_object_array_length is None
        else limits.max_object_array_length,
    )
