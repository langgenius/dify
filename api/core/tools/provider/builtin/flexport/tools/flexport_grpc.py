import json
import os
import tempfile
from pathlib import Path
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
            # Create temporary proto file
            proto_file = os.path.join(tmp_dir, 'temp.proto')
            Path(proto_file).write_text(self.proto_content)
            
            desc_file = os.path.join(tmp_dir, 'desc.pb')
            
            protoc.main([
                'protoc',
                f'--proto_path={tmp_dir}',
                f'--descriptor_set_out={desc_file}',
                '--include_imports',
                proto_file
            ])
            
            return Path(desc_file).read_bytes()

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
        """Get the package name from proto file"""
        if self.file_desc_set and self.file_desc_set.file:
            package_name = self.file_desc_set.file[0].package
            print(f"Found package name: {package_name}")
            return package_name
        print("Warning: No package name found")
        return ""

    def call_method(self, service_name, method_name, request_data):
        try:
            package_name = self._get_package_name()
            # If service_name already contains package name, use it directly
            if '.' in service_name:
                qualified_service = service_name
            else:
                qualified_service = (
                    f"{package_name}.{service_name}" 
                    if package_name 
                    else service_name
                )
            
            print(f"\nLooking for service: {qualified_service}")
            
            # Print all available services
            print("\nAvailable services in proto file:")
            for file_proto in self.file_desc_set.file:
                for service in file_proto.service:
                    print(f"- {file_proto.package}.{service.name}")
            
            # Get service descriptor
            try:
                service_desc = self.desc_pool.FindServiceByName(qualified_service)
            except KeyError as e:
                print(f"\nFailed to find service '{qualified_service}'")
                print("Available services in descriptor pool:")
                try:
                    for name in self.desc_pool.FindAllServices():
                        print(f"- {name}")
                except Exception as e:
                    print(f"Error listing services: {e}")
                raise
            
            method_desc = service_desc.FindMethodByName(method_name)
            
            # Get message descriptors
            input_type_name = (
                f"{package_name}.{method_desc.input_type.name}" 
                if package_name 
                else method_desc.input_type.name
            )
            output_type_name = (
                f"{package_name}.{method_desc.output_type.name}" 
                if package_name 
                else method_desc.output_type.name
            )
            
            request_desc = self.desc_pool.FindMessageTypeByName(input_type_name)
            response_desc = self.desc_pool.FindMessageTypeByName(output_type_name)
            
            # Create message factory
            factory = message_factory.MessageFactory(self.desc_pool)
            request_class = factory.GetPrototype(request_desc)
            response_class = factory.GetPrototype(response_desc)
            
            # Create request message
            request = request_class()
            for key, value in request_data.items():
                setattr(request, key, value)
            
            # Build complete method name
            method_full_name = f"/{qualified_service}/{method_name}"
            
            print(f"Calling {method_full_name}")
            print(f"Request: {json_format.MessageToJson(request, preserving_proto_field_name=True)}")
            
            def serialize_request(request_msg):
                return request_msg.SerializeToString()

            def deserialize_response(response_bytes):
                response_msg = response_class()
                response_msg.ParseFromString(response_bytes)
                return response_msg
            
            # Create gRPC method call
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
        """Format proto definition content to make it more readable"""
        # Remove extra spaces
        content = ' '.join(content.split())
        
        # Replace keywords with formatting marks
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
            
        # Process message definition fields
        lines = content.split('\n')
        formatted_lines = []
        for line in lines:
            if 'string' in line and '=' in line:
                line = '    ' + line.strip()
            formatted_lines.append(line)
        
        content = '\n'.join(formatted_lines)
        content = content.replace('}{', '}\n\n{')
        content = content.replace('}\nmessage', '}\n\nmessage')
        
        return content 


class FlexportGrpcTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
               tool_parameters: dict[str, Any] 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """invoke tools"""
        proto_content = tool_parameters.get('proto_content')
        service = tool_parameters.get('service')
        method = tool_parameters.get('method')
        method_parameters = tool_parameters.get('method_parameters')
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
        