from dataclasses import dataclass


@dataclass(frozen=True)
class CodeNodeLimits:
    max_string_length: int
    max_number: int | float
    min_number: int | float
    max_precision: int
    max_depth: int
    max_number_array_length: int
    max_string_array_length: int
    max_object_array_length: int
