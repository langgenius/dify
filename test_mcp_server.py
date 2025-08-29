#!/usr/bin/env python3
"""
Simple MCP Server for testing headers functionality
This server logs all received headers and returns them in responses
"""

from flask import Flask, request, jsonify
import json
import logging
from datetime import datetime

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()})

@app.route('/', methods=['POST'])
def handle_mcp_request():
    """Handle MCP JSON-RPC requests"""
    try:
        # 记录请求信息
        logger.info(f"Received request from {request.remote_addr}")
        logger.info(f"Request headers: {dict(request.headers)}")
        logger.info(f"Request method: {request.method}")
        
        # 解析请求体
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        logger.info(f"Request body: {json.dumps(data, indent=2)}")
        
        # 提取请求信息
        request_id = data.get('id')
        method = data.get('method')
        params = data.get('params', {})
        
        # 处理不同的 MCP 方法
        if method == 'initialize':
            response = {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "Test MCP Server",
                        "version": "1.0.0"
                    }
                }
            }
        
        elif method == 'tools/list':
            response = {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "tools": [
                        {
                            "name": "echo_headers",
                            "description": "Echo back all received headers",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "message": {
                                        "type": "string",
                                        "description": "Message to echo"
                                    }
                                },
                                "required": ["message"]
                            }
                        }
                    ]
                }
            }
        
        elif method == 'tools/call':
            tool_name = params.get('name')
            arguments = params.get('arguments', {})
            
            if tool_name == 'echo_headers':
                message = arguments.get('message', 'Hello from MCP server')
                response = {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Message: {message}\n\nReceived headers:\n{json.dumps(dict(request.headers), indent=2)}"
                            }
                        ]
                    }
                }
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method '{tool_name}' not found"
                    }
                }
        
        else:
            response = {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32601,
                    "message": f"Method '{method}' not found"
                }
            }
        
        # 记录响应
        logger.info(f"Response: {json.dumps(response, indent=2)}")
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"Error processing request: {e}")
        return jsonify({
            "jsonrpc": "2.0",
            "id": request_id if 'request_id' in locals() else None,
            "error": {
                "code": -32603,
                "message": f"Internal error: {str(e)}"
            }
        }), 500

@app.route('/test-headers')
def test_headers():
    """Test endpoint to verify headers are being sent correctly"""
    headers_info = {
        "received_headers": dict(request.headers),
        "timestamp": datetime.now().isoformat(),
        "message": "Headers received successfully"
    }
    
    logger.info(f"Test headers endpoint called: {json.dumps(headers_info, indent=2)}")
    
    return jsonify(headers_info)

if __name__ == '__main__':
    logger.info("Starting Test MCP Server on port 8000...")
    logger.info("This server will log all received headers for testing purposes")
    app.run(host='0.0.0.0', port=8000, debug=True)
