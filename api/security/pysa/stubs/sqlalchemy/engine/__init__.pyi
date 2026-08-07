from typing import Any

class Connection:
    def exec_driver_sql(
        self,
        statement: str,
        parameters: Any = ...,
        execution_options: Any = ...,
    ) -> Any: ...

def __getattr__(name: str) -> Any: ...
