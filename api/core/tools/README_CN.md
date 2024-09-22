# Tools

该模块提供了各Agent和Workflow中会使用的内置工具的调用、鉴权接口，并为 Dify 提供了统一的工具供应商的信息和凭据表单规则。

- 一方面将工具和业务代码解耦，方便开发者对模型横向扩展，
- 另一方面提供了只需在后端定义供应商和工具，即可在前端页面直接展示，无需修改前端逻辑。

## 功能介绍

对于给Agent和Workflow提供的工具，我们当前将其分为两类：
- `Built-in Tools` 内置工具，即Dify内部实现的工具，通过硬编码的方式提供给Agent和Workflow使用。
- `Api-Based Tools` 基于API的工具，即通过调用第三方API实现的工具，`Api-Based Tool`不需要再额外定义，只需提供`OpenAPI` `Swagger` `OpenAI plugin`等接口文档即可。

### 内置工具供应商
![Alt text](docs/images/index/image.png)

### API工具供应商
![Alt text](docs/images/index/image-1.png)

## 工具接入
为了实现更灵活更强大的功能，Tools提供了一系列的接口，帮助开发者快速构建想要的工具，本文作为开发者的入门指南，将会以[快速接入](./docs/zh_Hans/tool_scale_out.md)和[高级接入](./docs/zh_Hans/advanced_scale_out.md)两部分介绍如何接入工具。

### [快速接入 👈🏻](./docs/zh_Hans/tool_scale_out.md)
快速接入可以帮助你在10~20分钟内完成工具的接入，但是这种接入方式只能实现简单的功能，如果你想要实现更复杂的功能，可以参考下面的高级接入。

### [高级接入 👈🏻](./docs/zh_Hans/advanced_scale_out.md)
高级接入将介绍如何实现更复杂的功能配置，包括实现图生图、实现多个工具的组合、实现参数、图片、文件在多个工具之间的流转。