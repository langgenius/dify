import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any, Union

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
        """初始化服务"""
        # 添加generated目录到Python路径
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
        identity: dict = None,
        credentials: dict = None,
        description: dict = None,
        parameters: list = None,
        runtime: dict = None,
    ):
        # 如果参数是字典列表，先转换为 ToolParameter 对象
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
                    options=[],  # 初始为空，会在 get_runtime_parameters 中设置
                )
                for param in parameters
            ]

        # 调用父类的初始化
        super().__init__(
            identity=identity, credentials=credentials, description=description, parameters=parameters, runtime=runtime
        )

    def _load_all_services(self) -> dict[str, dict[str, Any]]:
        """Load all available services from generated files"""
        service_map = {}
        base_dir = Path(__file__).parent.parent / "generated"

        if not base_dir.exists():
            print(f"Warning: Generated directory not found at {base_dir}")
            return service_map

        print(f"Scanning directory: {base_dir}")

        # 忽略的包前缀列表
        ignored_prefixes = {
            "google.type",
            "google.api",
            "google.rpc",
            "grpc.health",
        }

        # 首先检查 proto 文件中的服务定义
        for root, _, files in os.walk(base_dir):
            for file in files:
                if file.endswith("_pb2_grpc.py"):
                    try:
                        with open(os.path.join(root, file)) as f:
                            content = f.read()
                            # 检查文件是否包含服务定义
                            if "class" in content and "Stub" in content:
                                print(f"\nFound service in file: {file}")
                                print(content)

                                rel_path = os.path.relpath(os.path.join(root, file), base_dir)
                                module_path = os.path.splitext(rel_path)[0].replace(os.sep, ".")
                                module_path = module_path.removeprefix("flexport.")

                                # 检查是否是需要忽略的包
                                should_ignore = any(module_path.startswith(prefix) for prefix in ignored_prefixes)
                                if should_ignore:
                                    continue

                                base_module_name = os.path.splitext(file)[0].replace("_grpc", "")

                                print(f"\nTrying to import gRPC module: {module_path}")
                                print(f"Module file: {os.path.join(root, file)}")

                                try:
                                    # 导入 grpc 模块
                                    spec = importlib.util.spec_from_file_location(module_path, os.path.join(root, file))
                                    if spec is None:
                                        print(f"Could not create spec for {file}")
                                        continue

                                    grpc_module = importlib.util.module_from_spec(spec)
                                    sys.modules[module_path] = grpc_module
                                    spec.loader.exec_module(grpc_module)

                                    # 导入对应的 pb2 模块
                                    pb2_file = os.path.join(root, f"{base_module_name}.py")
                                    if not os.path.exists(pb2_file):
                                        print(f"pb2 file not found: {pb2_file}")
                                        continue

                                    pb2_module_path = module_path.replace("_grpc", "")
                                    spec = importlib.util.spec_from_file_location(pb2_module_path, pb2_file)
                                    if spec is None:
                                        print(f"Could not create spec for {base_module_name}")
                                        continue

                                    pb2_module = importlib.util.module_from_spec(spec)
                                    sys.modules[pb2_module_path] = pb2_module
                                    spec.loader.exec_module(pb2_module)

                                    # 查找所有服务类
                                    print(f"Looking for service classes in {module_path}")
                                    print(f"Module content: {dir(grpc_module)}")

                                    # 检查模块中的所有类
                                    for attr_name in dir(grpc_module):
                                        attr = getattr(grpc_module, attr_name)
                                        print(f"Found attribute: {attr_name} ({type(attr)})")
                                        if attr_name.endswith("Stub"):
                                            try:
                                                service_name = attr_name[:-4]
                                                package_parts = module_path.split(".")
                                                package_name = ".".join(package_parts[:-1])
                                                full_service_name = f"{package_name}.{service_name}"

                                                methods = self._get_service_methods(grpc_module, attr_name)
                                                print(f"Found service class: {attr_name}")
                                                print(f"Methods: {methods}")

                                                if methods:  # 只添加有方法的服务
                                                    service_map[full_service_name] = {
                                                        "stub_class": attr,
                                                        "messages": pb2_module,
                                                        "methods": methods,
                                                    }
                                                    print(f"Loaded service: {full_service_name}")
                                                    print(f"Available methods: {methods}")
                                            except Exception as e:
                                                print(f"Error processing service {attr_name}: {str(e)}")
                                                continue

                                except ImportError as e:
                                    print(f"Import error loading service from {module_path}: {str(e)}")
                                    continue
                                except Exception as e:
                                    print(f"Error loading service from {module_path}: {str(e)}")
                                    continue

                    except Exception as e:
                        print(f"Error processing file {file}: {str(e)}")
                        continue

        print(f"\nFinal service_map: {service_map}")
        return service_map

    def _get_service_methods(self, grpc_module: Any, stub_name: str) -> list[str]:
        """Get all available methods for a service"""
        methods = []
        print(f"Checking methods for stub: {stub_name}")

        # 获取 Stub 类
        stub_class = getattr(grpc_module, stub_name)
        print(f"Stub class: {stub_class}")

        # 获取 __init__ 方法的源代码
        import inspect

        init_source = inspect.getsource(stub_class.__init__)
        print(f"Init source:\n{init_source}")

        # 从源代码中解析方法名
        import re

        method_matches = re.finditer(r"self\.(\w+)\s*=\s*channel\.unary_unary", init_source)
        for match in method_matches:
            method_name = match.group(1)
            print(f"Found method from source: {method_name}")
            methods.append(method_name)

        print(f"Found methods: {methods}")
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
        """获取运行时参数，返回参数列表"""
        try:
            print("Getting runtime parameters...")
            print(f"Available services: {list(self.service_map.keys())}")

            # 构建服务和方法的组合选项
            service_method_options = []
            for service_name, service_info in self.service_map.items():
                methods = service_info.get("methods", [])
                print(f"Service {service_name} has methods: {methods}")
                for method in methods:
                    option_value = f"{service_name}::{method}"
                    option_label = f"{service_name} - {method}"
                    service_method_options.append(
                        ToolParameterOption(
                            value=option_value, label=I18nObject(en_US=option_label, zh_Hans=option_label)
                        )
                    )

            # 按字母顺序排序选项
            service_method_options.sort(key=lambda x: x.value)
            print(f"Total options generated: {len(service_method_options)}")
            if service_method_options:
                print("Sample options:", service_method_options[:2])

            parameters = [
                ToolParameter(
                    name="host",
                    type=ToolParameter.ToolParameterType.STRING,
                    required=True,
                    label=I18nObject(en_US="Host Address", zh_Hans="服务器地址"),
                    human_description=I18nObject(
                        en_US="The host address of the gRPC server (e.g. localhost:50051)",
                        zh_Hans="gRPC服务器地址（例如 localhost:50051）",
                    ),
                    llm_description="The host address and port of the gRPC server",
                    form=ToolParameter.ToolParameterForm.FORM,
                ),
                ToolParameter(
                    name="service_method",
                    type=ToolParameter.ToolParameterType.SELECT,
                    required=True,
                    label=I18nObject(en_US="Service and Method", zh_Hans="服务和方法"),
                    human_description=I18nObject(
                        en_US="Select the gRPC service and method to call", zh_Hans="选择要调用的gRPC服务和方法"
                    ),
                    llm_description="The full service name and method to call",
                    form=ToolParameter.ToolParameterForm.FORM,
                    options=service_method_options,
                ),
                ToolParameter(
                    name="method_parameters",
                    type=ToolParameter.ToolParameterType.STRING,
                    required=True,
                    label=I18nObject(en_US="Method Parameters", zh_Hans="方法参数"),
                    human_description=I18nObject(
                        en_US="JSON string of parameters for the method", zh_Hans="方法参数的JSON字符串"
                    ),
                    llm_description="JSON formatted string containing the parameters for the method call",
                    form=ToolParameter.ToolParameterForm.LLM,
                ),
            ]

            print("Returning parameters with options")
            return parameters

        except Exception as e:
            print(f"Error getting runtime parameters: {str(e)}")
            import traceback

            traceback.print_exc()
            return []
