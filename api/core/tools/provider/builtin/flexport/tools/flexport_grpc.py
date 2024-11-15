import json
import os
import tempfile
from typing import Any, Union

import grpc
from google.protobuf import descriptor_pb2, descriptor_pool, json_format, message_factory
from grpc_tools import protoc

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DynamicGrpcClient:
    def __init__(self, proto_content):
        self.channel = grpc.insecure_channel('localhost:50051')
        self.proto_content = proto_content
        self.desc_pool = descriptor_pool.DescriptorPool()
        self.file_desc_set = None
        self._load_proto()

    def _compile_proto_to_desc(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            # 创建临时 proto 文件
            proto_file = os.path.join(tmp_dir, 'temp.proto')
            with open(proto_file, 'w') as f:
                f.write(self.proto_content)
            
            desc_file = os.path.join(tmp_dir, 'desc.pb')
            
            protoc.main([
                'protoc',
                f'--proto_path={tmp_dir}',
                f'--descriptor_set_out={desc_file}',
                '--include_imports',
                proto_file
            ])
            
            with open(desc_file, 'rb') as f:
                return f.read()

    def _load_proto(self):
        try:
            proto_desc = self._compile_proto_to_desc()
            self.file_desc_set = descriptor_pb2.FileDescriptorSet()
            self.file_desc_set.ParseFromString(proto_desc)
            
            print("\nLoading proto definition...")
            for file_proto in self.file_desc_set.file:
                print(f"Processing definition: {file_proto.name}")
                print(f"Package: {file_proto.package}")
                print(f"Services: {[s.name for s in file_proto.service]}")
                self.desc_pool.Add(file_proto)
            print("Proto definition loaded successfully")
        except Exception as e:
            print(f"Error loading proto definition: {e}")
            raise

    def _get_package_name(self):
        """获取proto文件的包名"""
        if self.file_desc_set and self.file_desc_set.file:
            package_name = self.file_desc_set.file[0].package
            print(f"Found package name: {package_name}")
            return package_name
        print("Warning: No package name found")
        return ""

    def call_method(self, service_name, method_name, request_data):
                
        try:
            package_name = self._get_package_name()
            # 如果service_name已经包含包名，就直接使用
            if '.' in service_name:
                qualified_service = service_name
            else:
                qualified_service = f"{package_name}.{service_name}" if package_name else service_name
            
            print(f"\nLooking for service: {qualified_service}")
            
            # 打印所有可用的服务
            print("\nAvailable services in proto file:")
            for file_proto in self.file_desc_set.file:
                for service in file_proto.service:
                    print(f"- {file_proto.package}.{service.name}")
            
            # 获取服务描述符
            try:
                service_desc = self.desc_pool.FindServiceByName(qualified_service)
            except KeyError as e:
                print(f"\nFailed to find service '{qualified_service}'")
                print("Available services in descriptor pool:")
                # 尝试列出描述符池中的所有服务
                try:
                    for name in self.desc_pool.FindAllServices():
                        print(f"- {name}")
                except Exception as e:
                    print(f"Error listing services: {e}")
                raise
            
            method_desc = service_desc.FindMethodByName(method_name)
            
            # 获取消息描述符
            input_type_name = f"{package_name}.{method_desc.input_type.name}" if package_name else method_desc.input_type.name
            output_type_name = f"{package_name}.{method_desc.output_type.name}" if package_name else method_desc.output_type.name
            
            request_desc = self.desc_pool.FindMessageTypeByName(input_type_name)
            response_desc = self.desc_pool.FindMessageTypeByName(output_type_name)
            
            # 创建消息工厂
            factory = message_factory.MessageFactory(self.desc_pool)
            request_class = factory.GetPrototype(request_desc)
            response_class = factory.GetPrototype(response_desc)
            
            # 创建请求消息
            request = request_class()
            for key, value in request_data.items():
                setattr(request, key, value)
            
            # 构建完整的方法名
            method_full_name = f"/{qualified_service}/{method_name}"
            
            print(f"Calling {method_full_name}")
            print(f"Request: {json_format.MessageToJson(request, preserving_proto_field_name=True)}")
            
            def serialize_request(request_msg):
                return request_msg.SerializeToString()

            def deserialize_response(response_bytes):
                response_msg = response_class()
                response_msg.ParseFromString(response_bytes)
                return response_msg
            
            # 创建 gRPC 方法调用
            rpc = self.channel.unary_unary(
                method_full_name,
                request_serializer=serialize_request,
                response_deserializer=deserialize_response
            )
            
            response = rpc(request)
            print(f"Response received: {json_format.MessageToJson(response, preserving_proto_field_name=True)}")
            return response
            
        except Exception as e:
            print(f"Error details: {str(e)}")
            if isinstance(e, grpc.RpcError):
                print(f"RPC Error code: {e.code()}")
                print(f"RPC Error details: {e.details()}")
            raise
        try:
            package_name = self._get_package_name()
            # 如果service_name已经包含包名，就直接使用
            if '.' in service_name:
                qualified_service = service_name
            else:
                qualified_service = f"{package_name}.{service_name}" if package_name else service_name
            
            print(f"\nLooking for service: {qualified_service}")
            
            # 打印所有可用的服务
            print("\nAvailable services in proto file:")
            for file_proto in self.file_desc_set.file:
                for service in file_proto.service:
                    print(f"- {file_proto.package}.{service.name}")
            
            # 获取服务描述符
            try:
                service_desc = self.desc_pool.FindServiceByName(qualified_service)
            except KeyError as e:
                print(f"\nFailed to find service '{qualified_service}'")
                print("Available services in descriptor pool:")
                # 尝试列出描述符池中的所有服务
                try:
                    for name in self.desc_pool.FindAllServices():
                        print(f"- {name}")
                except Exception as e:
                    print(f"Error listing services: {e}")
                raise
            
            method_desc = service_desc.FindMethodByName(method_name)
            
            # 获取消息描述符
            input_type_name = f"{package_name}.{method_desc.input_type.name}" if package_name else method_desc.input_type.name
            output_type_name = f"{package_name}.{method_desc.output_type.name}" if package_name else method_desc.output_type.name
            
            request_desc = self.desc_pool.FindMessageTypeByName(input_type_name)
            response_desc = self.desc_pool.FindMessageTypeByName(output_type_name)
            
            # 创建消息工厂
            factory = message_factory.MessageFactory(self.desc_pool)
            request_class = factory.GetPrototype(request_desc)
            response_class = factory.GetPrototype(response_desc)
            
            # 创建请求消息
            request = request_class()
            for key, value in request_data.items():
                setattr(request, key, value)
            
            # 构建完整的方法名
            method_full_name = f"/{qualified_service}/{method_name}"
            
            print(f"Calling {method_full_name}")
            print(f"Request: {json_format.MessageToJson(request, preserving_proto_field_name=True)}")
            
            def serialize_request(request_msg):
                return request_msg.SerializeToString()

            def deserialize_response(response_bytes):
                response_msg = response_class()
                response_msg.ParseFromString(response_bytes)
                return response_msg
            
            # 创建 gRPC 方法调用
            rpc = self.channel.unary_unary(
                method_full_name,
                request_serializer=serialize_request,
                response_deserializer=deserialize_response
            )
            
            response = rpc(request)
            print(f"Response received: {json_format.MessageToJson(response, preserving_proto_field_name=True)}")
            return response
            
        except Exception as e:
            print(f"Error details: {str(e)}")
            if isinstance(e, grpc.RpcError):
                print(f"RPC Error code: {e.code()}")
                print(f"RPC Error details: {e.details()}")
            raise

    @staticmethod
    def format_proto_content(content):
        """
        格式化 proto 定义内容，使其更易读
        
        Args:
            content (str): 原始的 proto 定义字符串
            
        Returns:
            str: 格式化后的 proto 定义
        """
        # 移除多余的空格
        content = ' '.join(content.split())
        
        # 替换关键字为格式化标记
        replacements = [
            ('syntax = ', '\nsyntax = '),
            ('package ', '\npackage '),
            ('service ', '\nservice '),
            ('message ', '\nmessage '),
            ('rpc ', '\n    rpc '),
            (') {', ') {\n'),
            ('} }', '}\n}'),
            ('string ', '    string '),
        ]
        
        for old, new in replacements:
            content = content.replace(old, new)
            
        # 处理消息定义中的字段
        lines = content.split('\n')
        formatted_lines = []
        for line in lines:
            if 'string' in line and '=' in line:
                # 确保消息字段有正确的缩进
                line = '    ' + line.strip()
            formatted_lines.append(line)
        
        # 在大括号后添加换行
        content = '\n'.join(formatted_lines)
        content = content.replace('}{', '}\n\n{')
        
        # 确保消息定义之间有空行
        content = content.replace('}\nmessage', '}\n\nmessage')
        
        return content 


class FlexportGrpcTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
               tool_parameters: dict[str, Any] 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        
        proto_content = tool_parameters.get('proto_content')
        service = tool_parameters.get('service')
        method = tool_parameters.get('method')
        method_parameters = tool_parameters.get('method_parameters')
        # parse to dict
        method_parameters_dict = json.loads(method_parameters)   
                
        formatted_content = DynamicGrpcClient.format_proto_content(proto_content)
        client = DynamicGrpcClient(formatted_content)
        response = client.call_method(service, method, method_parameters_dict)        
        response_dict = json_format.MessageToDict(
            response, 
            preserving_proto_field_name=True
        )
        print("\nFormatted Response:")
        result = ""
        for field_name, value in response_dict.items():
            print(f"{field_name}: {value}")
            result += f"{field_name}: {value}\n"
            result += "price is 102"
        
        return self.create_text_message(text=result)
        