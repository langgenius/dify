# Model Runtime

该模块提供了各模型的调用、鉴权接口，并为 Dify 提供了统一的模型供应商的信息和凭据表单规则。

- 一方面将模型和上下游解耦，方便开发者对模型横向扩展，
- 另一方面提供了只需在后端定义供应商和模型，即可在前端页面直接展示，无需修改前端逻辑。

## 功能介绍

- 支持 5 种模型类型的能力调用

  - `LLM` - LLM 文本补全、对话，预计算 tokens 能力
  - `Text Embedidng Model` - 文本 Embedding ，预计算 tokens 能力
  - `Rerank Model` - 分段 Rerank 能力
  - `Speech-to-text Model` - 语音转文本能力
  - `Moderation` - Moderation 能力

- 模型供应商展示

  ![image-20231210143654461](./docs/zh_Hans/images/index/image-20231210143654461.png)

​	展示所有已支持的供应商列表，除了返回供应商名称、图标之外，还提供了支持的模型类型列表，预定义模型列表、配置方式以及配置凭据的表单规则等等，规则设计详见：[Schema](./schema.md)。

- 可选择的模型列表展示

  ![image-20231210144229650](./docs/zh_Hans/images/index/image-20231210144229650.png)

​	配置供应商/模型凭据后，可在此下拉（应用编排界面/默认模型）查看可用的 LLM 列表，其中灰色的为未配置凭据供应商的预定义模型列表，方便用户查看已支持的模型。

​	除此之外，该列表还返回了 LLM 可配置的参数信息和规则，如下图：

​	![image-20231210144814617](./docs/zh_Hans/images/index/image-20231210144814617.png)	

​	这里的参数均为后端定义，相比之前只有 5 种固定参数，这里可为不同模型设置所支持的各种参数，详见：[Schema](./docs/zh_Hans/schema.md#ParameterRule)。

- 供应商/模型凭据鉴权

  ![image-20231210151548521](./docs/zh_Hans/images/index/image-20231210151548521.png)

![image-20231210151628992](./docs/zh_Hans/images/index/image-20231210151628992.png)

​	供应商列表返回了凭据表单的配置信息，可通过 Runtime 提供的接口对凭据进行鉴权，上图 1 为供应商凭据 DEMO，上图 2 为模型凭据 DEMO。

## 结构

![](./docs/zh_Hans/images/index/image-20231210165243632.png)

Model Runtime 分三层：

- 最外层为工厂方法

  提供获取所有供应商、所有模型列表、获取供应商实例、供应商/模型凭据鉴权方法。

- 第二层为供应商层

  提供获取当前供应商模型列表、获取模型实例、供应商凭据鉴权、供应商配置规则信息，**可横向扩展**以支持不同的供应商。

- 最底层为模型层

  提供各种模型类型的直接调用、预定义模型配置信息、获取预定义/远程模型列表、模型凭据鉴权方法，不同模型额外提供了特殊方法，如 LLM 提供预计算 tokens 方法、获取费用信息方法等，**可横向扩展**同供应商下不同的模型（支持的模型类型下）。



## 下一步

- 增加新的供应商配置：[链接](./docs/zh_Hans/provider_scale_out.md)
- 为已存在的供应商新增模型：[链接](./docs/zh_Hans/provider_scale_out.md#增加模型)
- 查看 YAML 配置规则：[链接](./docs/zh_Hans/schema.md)
- 接口方法实现：[链接](./docs/zh_Hans/interfaces.md)