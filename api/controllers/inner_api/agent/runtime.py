"""Strict Agent Resources sharing existing controller/service owners.

Outer method decorators run before inherited parsing, sessions and services.
Legacy Resource authentication cannot grant this admission.
"""

# Flask-RESTX declares a mutable Resource decorator list; each subclass owns
# its own list. Tuple/ClassVar overrides conflict with that upstream contract.
from controllers.inner_api import inner_api_ns
from controllers.inner_api.agent import files, llm, native_testing, tools
from controllers.inner_api.knowledge import retrieval
from controllers.inner_api.plugin import agent_config
from controllers.inner_api.wraps import AgentRuntimeRefused, agent_runtime_api_only
from libs.external_api import document_errors


@inner_api_ns.route("/agent/runtime/llm/invoke")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeLLMApi(llm.AgentLLMInvokeApi):
    method_decorators = [agent_runtime_api_only("model")]


document_errors(AgentRuntimeLLMApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/tools/invoke")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeToolApi(tools.AgentToolInvokeApi):
    method_decorators = [agent_runtime_api_only("core_tool")]


document_errors(AgentRuntimeToolApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/files/upload-request")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeUploadApi(files.AgentFileUploadRequestApi):
    method_decorators = [agent_runtime_api_only("file_upload")]


document_errors(AgentRuntimeUploadApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/files/download-request")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeDownloadApi(files.AgentFileDownloadRequestApi):
    method_decorators = [agent_runtime_api_only("file_download")]


document_errors(AgentRuntimeDownloadApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/knowledge/retrieve")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeKnowledgeApi(retrieval.InnerKnowledgeRetrieveApi):
    method_decorators = [agent_runtime_api_only("knowledge")]


document_errors(AgentRuntimeKnowledgeApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/config/<string:agent_id>/manifest")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeConfigManifestApi(agent_config.AgentConfigManifestApi):
    method_decorators = [agent_runtime_api_only("config")]


document_errors(AgentRuntimeConfigManifestApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/config/<string:agent_id>/download-request")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeConfigDownloadApi(agent_config.AgentConfigDownloadRequestApi):
    method_decorators = [agent_runtime_api_only("config")]


document_errors(AgentRuntimeConfigDownloadApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/config/<string:agent_id>/skills/<string:name>/inspect")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeConfigSkillApi(agent_config.AgentConfigSkillInspectApi):
    method_decorators = [agent_runtime_api_only("config")]


document_errors(AgentRuntimeConfigSkillApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/config/<string:agent_id>/push")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeConfigPushApi(agent_config.AgentConfigPushApi):
    method_decorators = [agent_runtime_api_only("config")]


document_errors(AgentRuntimeConfigPushApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/config/<string:agent_id>/env")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeConfigEnvApi(agent_config.AgentConfigEnvApi):
    method_decorators = [agent_runtime_api_only("config")]


document_errors(AgentRuntimeConfigEnvApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/config/<string:agent_id>/note")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeConfigNoteApi(agent_config.AgentConfigNoteApi):
    method_decorators = [agent_runtime_api_only("config")]


document_errors(AgentRuntimeConfigNoteApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/native-testing/prepare-run")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeNativePrepareApi(native_testing.AgentNativePrepareRunApi):
    method_decorators = [agent_runtime_api_only("prepare-run")]


document_errors(AgentRuntimeNativePrepareApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/native-testing/prepared-config")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeNativeConfigApi(native_testing.AgentNativePreparedConfigApi):
    method_decorators = [agent_runtime_api_only("prepared-config")]


document_errors(AgentRuntimeNativeConfigApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/native-testing/before-call")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeNativeBeforeApi(native_testing.AgentNativeBeforeCallApi):
    method_decorators = [agent_runtime_api_only("native-control")]


document_errors(AgentRuntimeNativeBeforeApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/native-testing/outcome")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeNativeOutcomeApi(native_testing.AgentNativeOutcomeApi):
    method_decorators = [agent_runtime_api_only("native-control")]


document_errors(AgentRuntimeNativeOutcomeApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/native-testing/materialize")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeNativeMaterializeApi(native_testing.AgentNativeMaterializeApi):
    method_decorators = [agent_runtime_api_only("native-control")]


document_errors(AgentRuntimeNativeMaterializeApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/native-testing/claim-dispatch")
@inner_api_ns.doc(
    security="AgentBearer",
    params={
        "X-Dify-Agent-Run": {
            "in": "header",
            "required": True,
            "description": "Canonical base64url exact Run selection",
        }
    },
)
class AgentRuntimeNativeClaimApi(native_testing.AgentNativeDispatchClaimApi):
    method_decorators = [agent_runtime_api_only("native-control")]

    @inner_api_ns.expect(inner_api_ns.models[native_testing.AgentPhysicalDispatchPayload.__name__])
    @inner_api_ns.response(
        200, "Physical shell dispatch claimed", inner_api_ns.models[native_testing.AgentDispatchClaimResponse.__name__]
    )
    def post(self):
        from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload

        from runtime_contracts.builder.execution import BuilderExecutionPolicyError

        payload = native_testing._parse(AgentPhysicalDispatchPayload)
        try:
            if payload.intent.kind not in {"shell", "bootstrap"}:
                raise BuilderExecutionPolicyError("native_agent_boundary_unavailable")
            native_testing.agent_operations_for_ref(payload.ref).claim_shell_dispatch(envelope=payload)
        except BuilderExecutionPolicyError:
            raise native_testing.AgentNativeControlRefused() from None
        return {"claimed": True}


document_errors(AgentRuntimeNativeClaimApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/native-testing/prepare-intent")
class AgentRuntimeNativeIntentApi(native_testing.AgentNativePrepareIntentApi):
    method_decorators = [agent_runtime_api_only("native-control")]


document_errors(AgentRuntimeNativeIntentApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/native-testing/results")
class AgentRuntimeNativeStoreResultApi(native_testing.AgentNativeStoreResultApi):
    method_decorators = [agent_runtime_api_only("native-control")]


document_errors(AgentRuntimeNativeStoreResultApi, AgentRuntimeRefused)


@inner_api_ns.route("/agent/runtime/native-testing/read-result")
class AgentRuntimeNativeReadResultApi(native_testing.AgentNativeReadResultApi):
    method_decorators = [agent_runtime_api_only("native-control")]


document_errors(AgentRuntimeNativeReadResultApi, AgentRuntimeRefused)
