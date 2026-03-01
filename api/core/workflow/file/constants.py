from typing import Any

# TODO(QuantumGhost): Refactor variable type identification. Instead of directly
# comparing `dify_model_identity` with constants throughout the codebase, extract
# this logic into a dedicated function. This would encapsulate the implementation
# details of how different variable types are identified.
FILE_MODEL_IDENTITY = "__dify__file__"


def maybe_file_object(o: Any) -> bool:
    return isinstance(o, dict) and o.get("dify_model_identity") == FILE_MODEL_IDENTITY
