## 增加新供应商

供应商支持三种模型配置方式：

- `predefined-model  ` 预定义模型

  表示用户只需要配置统一的供应商凭据即可使用供应商下的预定义模型。

- `customizable-model` 自定义模型

  用户需要新增每个模型的凭据配置，如 Xinference，它同时支持 LLM 和 Text Embedding，但是每个模型都有唯一的**model_uid**，如果想要将两者同时接入，就需要为每个模型配置一个**model_uid**。

- `fetch-from-remote` 从远程获取

  与 `predefined-model` 配置方式一致，只需要配置统一的供应商凭据即可，模型通过凭据信息从供应商获取。

  如 OpenAI，我们可以基于 gpt-turbo-3.5 来 Fine Tune 多个模型，而他们都位于同一个**api_key**下，当配置为 `fetch-from-remote` 时，开发者只需要配置统一的**api_key**即可让 DifyRuntime 获取到开发者所有的微调模型并接入 Dify。

这三种配置方式**支持共存**，即存在供应商支持 `predefined-model` + `customizable-model` 或 `predefined-model` + `fetch-from-remote` 等，也就是配置了供应商统一凭据可以使用预定义模型和从远程获取的模型，若新增了模型，则可以在此基础上额外使用自定义的模型。

## 开始

### 介绍

#### 名词解释

- `module`: 一个`module`即为一个 Python Package，或者通俗一点，称为一个文件夹，里面包含了一个`__init__.py`文件，以及其他的`.py`文件。

#### 步骤

新增一个供应商主要分为几步，这里简单列出，帮助大家有一个大概的认识，具体的步骤会在下面详细介绍。

- 创建供应商 yaml 文件，根据[ProviderSchema](./schema.md#provider)编写
- 创建供应商代码，实现一个`class`。
- 根据模型类型，在供应商`module`下创建对应的模型类型 `module`，如`llm`或`text_embedding`。
- 根据模型类型，在对应的模型`module`下创建同名的代码文件，如`llm.py`，并实现一个`class`。
- 如果有预定义模型，根据模型名称创建同名的 yaml 文件在模型`module`下，如`claude-2.1.yaml`，根据[AIModelEntity](./schema.md#aimodelentity)编写。
- 编写测试代码，确保功能可用。

### 开始吧

增加一个新的供应商需要先确定供应商的英文标识，如 `anthropic`，使用该标识在 `model_providers` 创建以此为名称的 `module`。

在此 `module` 下，我们需要先准备供应商的 YAML 配置。

#### 准备供应商 YAML

此处以 `Anthropic` 为例，预设了供应商基础信息、支持的模型类型、配置方式、凭据规则。

```YAML
provider: anthropic  # 供应商标识
label:  # 供应商展示名称，可设置 en_US 英文、zh_Hans 中文两种语言，zh_Hans 不设置将默认使用 en_US。
  en_US: Anthropic
icon_small:  # 供应商小图标，存储在对应供应商实现目录下的 _assets 目录，中英文策略同 label
  en_US: icon_s_en.png
icon_large:  # 供应商大图标，存储在对应供应商实现目录下的 _assets 目录，中英文策略同 label
  en_US: icon_l_en.png
supported_model_types:  # 支持的模型类型，Anthropic 仅支持 LLM
- llm
configurate_methods:  # 支持的配置方式，Anthropic 仅支持预定义模型
- predefined-model
provider_credential_schema:  # 供应商凭据规则，由于 Anthropic 仅支持预定义模型，则需要定义统一供应商凭据规则
  credential_form_schemas:  # 凭据表单项列表
  - variable: anthropic_api_key  # 凭据参数变量名
    label:  # 展示名称
      en_US: API Key
    type: secret-input  # 表单类型，此处 secret-input 代表加密信息输入框，编辑时只展示屏蔽后的信息。
    required: true  # 是否必填
    placeholder:  # PlaceHolder 信息
      zh_Hans: 在此输入您的 API Key
      en_US: Enter your API Key
  - variable: anthropic_api_url
    label:
      en_US: API URL
    type: text-input  # 表单类型，此处 text-input 代表文本输入框
    required: false
    placeholder:
      zh_Hans: 在此输入您的 API URL
      en_US: Enter your API URL
```

如果接入的供应商提供自定义模型，比如`OpenAI`提供微调模型，那么我们就需要添加[`model_credential_schema`](./schema.md#modelcredentialschema)，以`OpenAI`为例：

```yaml
model_credential_schema:
  model: # 微调模型名称
    label:
      en_US: Model Name
      zh_Hans: 模型名称
    placeholder:
      en_US: Enter your model name
      zh_Hans: 输入模型名称
  credential_form_schemas:
  - variable: openai_api_key
    label:
      en_US: API Key
    type: secret-input
    required: true
    placeholder:
      zh_Hans: 在此输入您的 API Key
      en_US: Enter your API Key
  - variable: openai_organization
    label:
        zh_Hans: 组织 ID
        en_US: Organization
    type: text-input
    required: false
    placeholder:
      zh_Hans: 在此输入您的组织 ID
      en_US: Enter your Organization ID
  - variable: openai_api_base
    label:
      zh_Hans: API Base
      en_US: API Base
    type: text-input
    required: false
    placeholder:
      zh_Hans: 在此输入您的 API Base
      en_US: Enter your API Base
```

也可以参考 `model_providers` 目录下其他供应商目录下的 YAML 配置信息，完整的 YAML 规则见：[Schema](schema.md#provider)。

#### 实现供应商代码

我们需要在`model_providers`下创建一个同名的 python 文件，如`anthropic.py`，并实现一个`class`，继承`__base.provider.Provider`基类，如`AnthropicProvider`。

##### 自定义模型供应商

当供应商为 Xinference 等自定义模型供应商时，可跳过该步骤，仅创建一个空的`XinferenceProvider`类即可，并实现一个空的`validate_provider_credentials`方法，该方法并不会被实际使用，仅用作避免抽象类无法实例化。

```python
class XinferenceProvider(Provider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        pass
```

##### 预定义模型供应商

供应商需要继承 `__base.model_provider.ModelProvider` 基类，实现 `validate_provider_credentials` 供应商统一凭据校验方法即可，可参考 [AnthropicProvider](https://github.com/langgenius/dify-runtime/blob/main/lib/model_providers/anthropic/anthropic.py)。

```python
def validate_provider_credentials(self, credentials: dict) -> None:
    """
    Validate provider credentials
    You can choose any validate_credentials method of model type or implement validate method by yourself,
    such as: get model list api

    if validate failed, raise exception

    :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
    """
```

当然也可以先预留 `validate_provider_credentials` 实现，在模型凭据校验方法实现后直接复用。

#### 增加模型

#### [增加预定义模型 👈🏻](./predefined_model_scale_out.md)

对于预定义模型，我们可以通过简单定义一个 yaml，并通过实现调用代码来接入。

#### [增加自定义模型 👈🏻](./customizable_model_scale_out.md)

对于自定义模型，我们只需要实现调用代码即可接入，但是它需要处理的参数可能会更加复杂。

______________________________________________________________________

### 测试

为了保证接入供应商/模型的可用性，编写后的每个方法均需要在 `tests` 目录中编写对应的集成测试代码。

依旧以 `Anthropic` 为例。

在编写测试代码前，需要先在 `.env.example` 新增测试供应商所需要的凭据环境变量，如：`ANTHROPIC_API_KEY`。

在执行前需要将 `.env.example` 复制为 `.env` 再执行。

#### 编写测试代码

在 `tests` 目录下创建供应商同名的 `module`: `anthropic`，继续在此模块中创建 `test_provider.py` 以及对应模型类型的 test py 文件，如下所示：

```shell
.
├── __init__.py
├── anthropic
│   ├── __init__.py
│   ├── test_llm.py       # LLM 测试
│   └── test_provider.py  # 供应商测试
```

针对上面实现的代码的各种情况进行测试代码编写，并测试通过后提交代码。
