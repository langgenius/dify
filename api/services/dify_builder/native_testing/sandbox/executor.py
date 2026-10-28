"""Actual Graphon CodeExecutorProtocol through existing transformers and C02.

No interpreter or parallel graph execution lives here. Trusted composition binds
one producer to the actual native node and one physical owner to its retained root.
"""

from collections.abc import Mapping
from typing import Any

from core.helper.code_executor.code_executor import CodeExecutor
from graphon.nodes.code.entities import CodeLanguage
from runtime_contracts.builder.execution import canonical_json
from runtime_contracts.code_execution import CodeExecutionError
from services.dify_builder.native_testing.sandbox.host import HostNativeCodeTransport
from services.dify_builder.native_testing.sandbox.qualification import (
    _JSON,
    BOUNDS,
    refuse,
)


class _AttestedTransport:
    def __init__(self, *, prepared, transport):
        self.prepared, self.transport = prepared, transport

    def execute(self, *, language, preload, code):
        p = self.prepared
        if (language, preload, code) != (p.profile.language, p.preload, p.runner):
            refuse()
        return self.transport.execute(language=language, preload=preload, code=code)


class NativeCodeExecutor:
    def __init__(self, *, producer, calls, owner, on_prepared):
        self.producer, self.calls, self.owner, self.on_prepared = (
            producer,
            calls,
            owner,
            on_prepared,
        )

    def execute(self, *, language: CodeLanguage, code: str, inputs: Mapping[str, Any]) -> Mapping[str, Any]:
        prepared = self.producer.prepare(language=language, code=code, inputs=inputs)
        if self.on_prepared() is not None:
            refuse()

        def dispatch(permit):
            q = self.producer.qualification
            q.check()
            self.owner.check_current(self.owner.acquisition)
            # Reattest the same protected source before any reservation/SDK I/O.
            context = self.producer.validate_prepared(prepared)
            cap = q.capability
            transport = HostNativeCodeTransport(
                owner=self.owner,
                calls=self.calls,
                ref=context.ref,
                intent=prepared.intent,
                permit=permit,
                spec=prepared.spec,
                profile=prepared.profile,
                bounds=prepared.bounds,
                endpoint=cap.endpoint,
                auth_token=cap.auth_token.get_secret_value(),
                create_seconds=BOUNDS["create_seconds"],
                join_seconds=BOUNDS["join_seconds"],
            )
            try:
                result = CodeExecutor.execute_workflow_code_template(
                    language=language,
                    code=code,
                    inputs=inputs,
                    transport=_AttestedTransport(prepared=prepared, transport=transport),
                )
                value = _JSON.validate_python(result, strict=True)
                if type(value) is not dict or len(canonical_json(value)) > BOUNDS["result_bytes"]:
                    refuse()
                return value
            except Exception:
                # Native control is BaseException and passes unchanged. Ordinary
                # transformer/SDK messages can contain raw source/stdout/secrets.
                raise CodeExecutionError("Native code execution unavailable") from None

        result = self.calls.call(ref=self.producer.association.ref, intent=prepared.intent, dispatch=dispatch)
        self.producer.finish()
        if type(result) is not dict:
            refuse()
        return result

    def is_execution_error(self, error: BaseException) -> bool:
        return isinstance(error, CodeExecutionError)
