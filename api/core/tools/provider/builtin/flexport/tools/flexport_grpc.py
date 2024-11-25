import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional, Union

import grpc
from google.protobuf import json_format
from pydantic import Field, model_validator

from core.tools.entities.tool_entities import I18nObject, ToolInvokeMessage, ToolParameter, ToolParameterOption
from core.tools.tool.builtin_tool import BuiltinTool


class FlexportGrpcTool(BuiltinTool):
    service_map: dict[str, dict[str, Any]] = Field(default_factory=dict)
    stubs: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def initialize_services(self):
        """Initialize services"""
        # Add generated directory to Python path
        generated_dir = Path(__file__).parent.parent / "generated"
        if str(generated_dir) not in sys.path:
            sys.path.insert(0, str(generated_dir))

        try:
            self.service_map = self._load_all_services()
        except Exception as e:
            print(f"Error loading services: {str(e)}")
            self.service_map = {}

        return self

    def __init__(
        self,
        identity: Optional[dict] = None,
        credentials: Optional[dict] = None,
        description: Optional[dict] = None,
        parameters: Optional[list] = None,
        runtime: Optional[dict] = None,
    ):
        # If parameters are dictionaries, convert them to ToolParameter objects
        if parameters and isinstance(parameters[0], dict):
            parameters = [
                ToolParameter(
                    name=param["name"],
                    type=ToolParameter.ToolParameterType(param["type"]),
                    required=param.get("required", False),
                    label=I18nObject(**param["label"]),
                    human_description=I18nObject(**param["human_description"])
                    if param.get("human_description")
                    else None,
                    llm_description=param.get("llm_description"),
                    form=ToolParameter.ToolParameterForm(param["form"]),
                    default=param.get("default", ""),
                    options=[],  # Initially empty, will be set in get_runtime_parameters
                )
                for param in parameters
            ]

        # Call the parent class's initialization
        super().__init__(
            identity=identity, credentials=credentials, description=description, parameters=parameters, runtime=runtime
        )

    def _load_all_services(self) -> dict[str, dict[str, Any]]:
        """Load all available services from generated files"""
        service_map = {}
        base_dir = Path(__file__).parent.parent / "generated"

        if not base_dir.exists():
            return service_map

        # List of package prefixes to ignore
        ignored_prefixes = {
            "google.type",
            "google.api",
            "google.rpc",
            "grpc.health",
        }

        # First check service definitions in proto files
        for root, _, files in os.walk(base_dir):
            for file in files:
                if file.endswith("_pb2_grpc.py"):
                    try:
                        content = Path(root).joinpath(file).read_text()
                        if "class" in content and "Stub" in content:
                            rel_path = os.path.relpath(os.path.join(root, file), base_dir)
                            module_path = os.path.splitext(rel_path)[0].replace(os.sep, ".")
                            module_path = module_path.removeprefix("flexport.")

                            # Check if package should be ignored
                            should_ignore = any(module_path.startswith(prefix) for prefix in ignored_prefixes)
                            if should_ignore:
                                continue

                            base_module_name = os.path.splitext(file)[0].replace("_grpc", "")

                            try:
                                # Import gRPC module
                                spec = importlib.util.spec_from_file_location(module_path, os.path.join(root, file))
                                if spec is None:
                                    continue

                                grpc_module = importlib.util.module_from_spec(spec)
                                sys.modules[module_path] = grpc_module
                                spec.loader.exec_module(grpc_module)

                                # Import corresponding pb2 module
                                pb2_file = os.path.join(root, f"{base_module_name}.py")
                                if not os.path.exists(pb2_file):
                                    continue

                                pb2_module_path = module_path.replace("_grpc", "")
                                spec = importlib.util.spec_from_file_location(pb2_module_path, pb2_file)
                                if spec is None:
                                    continue

                                pb2_module = importlib.util.module_from_spec(spec)
                                sys.modules[pb2_module_path] = pb2_module
                                spec.loader.exec_module(pb2_module)

                                # Find all service classes
                                for attr_name in dir(grpc_module):
                                    attr = getattr(grpc_module, attr_name)
                                    if attr_name.endswith("Stub"):
                                        try:
                                            service_name = attr_name[:-4]
                                            package_parts = module_path.split(".")
                                            package_name = ".".join(package_parts[:-1])
                                            full_service_name = f"{package_name}.{service_name}"

                                            methods = self._get_service_methods(grpc_module, attr_name)

                                            # Only add services with methods
                                            if methods:
                                                service_map[full_service_name] = {
                                                    "stub_class": attr,
                                                    "messages": pb2_module,
                                                    "methods": methods,
                                                }
                                        except Exception:
                                            continue

                            except ImportError:
                                continue
                            except Exception:
                                continue

                    except Exception:
                        continue

        return service_map

    def _get_service_methods(self, grpc_module: Any, stub_name: str) -> list[str]:
        """Get all available methods for a service"""
        methods = []
        stub_class = getattr(grpc_module, stub_name)
        
        import inspect
        init_source = inspect.getsource(stub_class.__init__)
        
        import re
        method_matches = re.finditer(r"self\.(\w+)\s*=\s*channel\.unary_unary", init_source)
        for match in method_matches:
            method_name = match.group(1)
            methods.append(method_name)
        
        return methods

    def _get_stub(self, service_name: str, host: str) -> Any:
        """Get or create stub for the service"""
        stub_key = f"{service_name}:{host}"
        if stub_key not in self.stubs:
            service_config = self.service_map.get(service_name)
            if not service_config:
                raise ValueError(f"Unknown service: {service_name}")

            channel = grpc.insecure_channel(host)
            self.stubs[stub_key] = service_config["stub_class"](channel)

        return self.stubs[stub_key]

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """Invoke the gRPC tool"""
        try:
            host = tool_parameters.get("host")
            service_method = tool_parameters.get("service_method", "")
            service, method = service_method.split("::")
            method_parameters = json.loads(tool_parameters.get("method_parameters", "{}"))

            service_config = self.service_map.get(service)
            if not service_config:
                available_services = list(self.service_map.keys())
                raise ValueError(f"Unknown service: {service}. Available services: {available_services}")

            if method not in service_config["methods"]:
                raise ValueError(f"Unknown method: {method}. Available methods: {service_config['methods']}")

            stub = self._get_stub(service, host)
            messages = service_config["messages"]

            grpc_method = getattr(stub, method, None)
            if not grpc_method:
                raise ValueError(f"Method not found: {method}")

            request_type = getattr(messages, f"{method}Request", None)
            if not request_type:
                raise ValueError(f"Request message type not found for method: {method}")

            request = json_format.ParseDict(method_parameters, request_type())

            response = grpc_method(request)

            response_dict = json_format.MessageToDict(response, preserving_proto_field_name=True)

            result = "\n".join([f"{k}: {v}" for k, v in response_dict.items()])

            return self.create_text_message(text=result)

        except Exception as e:
            error_message = f"Error calling gRPC service: {str(e)}"
            if isinstance(e, grpc.RpcError):
                error_message += f"\nRPC Error code: {e.code()}\nDetails: {e.details()}"
            return self.create_text_message(text=error_message)

    def get_runtime_parameters(self) -> list[ToolParameter]:
        """Get runtime parameters and return parameter list"""
        try:
            service_method_options = []
            for service_name, service_info in self.service_map.items():
                methods = service_info.get("methods", [])
                for method in methods:
                    option_value = f"{service_name}::{method}"
                    option_label = f"{service_name} - {method}"
                    service_method_options.append(
                        ToolParameterOption(
                            value=option_value, label=I18nObject(en_US=option_label, zh_Hans=option_label)
                        )
                    )

            # Sort options alphabetically
            service_method_options.sort(key=lambda x: x.value)

            parameters = [
                ToolParameter(
                    name="host",
                    type=ToolParameter.ToolParameterType.STRING,
                    required=True,
                    label=I18nObject(en_US="Host Address", zh_Hans="Server Address"),
                    human_description=I18nObject(
                        en_US="The host address of the gRPC server (e.g. localhost:50051)",
                        zh_Hans="gRPC server address (e.g. localhost:50051)"
                    ),
                    llm_description="The host address and port of the gRPC server",
                    form=ToolParameter.ToolParameterForm.FORM,
                ),
                ToolParameter(
                    name="service_method",
                    type=ToolParameter.ToolParameterType.SELECT,
                    required=True,
                    label=I18nObject(en_US="Service and Method", zh_Hans="Service and Method"),
                    human_description=I18nObject(
                        en_US="Select the gRPC service and method to call",
                        zh_Hans="选择要调用的gRPC服务和方法"
                    ),
                    llm_description="The full service name and method to call",
                    form=ToolParameter.ToolParameterForm.FORM,
                    options=service_method_options,
                ),
                ToolParameter(
                    name="method_parameters",
                    type=ToolParameter.ToolParameterType.STRING,
                    required=True,
                    label=I18nObject(en_US="Method Parameters", zh_Hans="Method Parameters"),
                    human_description=I18nObject(
                        en_US="JSON string of parameters for the method",
                        zh_Hans="方法参数的JSON字符串"
                    ),
                    llm_description="JSON formatted string containing the parameters for the method call",
                    form=ToolParameter.ToolParameterForm.LLM,
                ),
            ]

            return parameters

        except Exception:
            return []
