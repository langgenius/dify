from typing import Any

class Session:
    def execute(
        self,
        statement: Any,
        params: Any = ...,
        *,
        execution_options: Any = ...,
        bind_arguments: Any = ...,
        _parent_execute_state: Any = ...,
        _add_event: Any = ...,
    ) -> Any: ...

def __getattr__(name: str) -> Any: ...
