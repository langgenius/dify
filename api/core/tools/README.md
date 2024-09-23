# Tools

This module implements built-in tools used in Agent Assistants and Workflows within Dify. You could define and display your own tools in this module, without modifying the frontend logic. This decoupling allows for easier horizontal scaling of Dify's capabilities.

## Feature Introduction

The tools provided for Agents and Workflows are currently divided into two categories:
- `Built-in Tools` are internally implemented within our product and are hardcoded for use in Agents and Workflows. 
- `Api-Based Tools`  leverage third-party APIs for implementation. You don't need to code to integrate these -- simply provide interface definitions in formats like `OpenAPI` , `Swagger`, or the `OpenAI-plugin` on the front-end.

### Built-in Tool Providers
![Alt text](docs/images/index/image.png)

### API Tool Providers
![Alt text](docs/images/index/image-1.png)

## Tool Integration

To enable developers to build flexible and powerful tools, we provide two guides:

### [Quick Integration 👈🏻](./docs/en_US/tool_scale_out.md)
Quick integration aims at quickly getting you up to speed with tool integration by walking over an example Google Search tool.

### [Advanced Integration 👈🏻](./docs/en_US/advanced_scale_out.md)
Advanced integration will offer a deeper dive into the module interfaces, and explain how to implement more complex capabilities, such as generating images, combining multiple tools, and managing the flow of parameters, images, and files between different tools.