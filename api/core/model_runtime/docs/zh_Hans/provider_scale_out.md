## 增加新供应商

供应商支持三种模型配置方式：

- `predefined-model  ` 预定义模型

  表示用户只需要配置统一的供应商凭据即可使用供应商下的预定义模型。

- `customizable-model` 自定义模型

  用户需要新增每个模型的凭据配置。

- `fetch-from-remote` 从远程获取

  与 `predefined-model` 配置方式一致，只需要配置统一的供应商凭据即可，模型通过凭据信息从供应商获取。

这三种配置方式**支持共存**，即存在供应商支持 `predefined-model` + `customizable-model` 或 `predefined-model` + `fetch-from-remote` 等，也就是配置了供应商统一凭据可以使用预定义模型和从远程获取的模型，若新增了模型，则可以在此基础上额外使用自定义的模型。

## 开始

增加一个新的供应商需要先确定供应商的英文标识，如 `anthropic`，使用该标识在 `model_providers` 创建以此为名称的 `module`。

在此 `module` 下，我们需要先准备供应商的 YAML 配置。

### 准备供应商 YAML

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

也可以参考  `model_providers` 目录下其他供应商目录下的 YAML 配置信息，完整的 YAML 规则见：[Schema](schema.md#Provider)。

### 实现供应商代码

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

---

### 增加模型

供应商集成完成后，接下来为供应商下模型的接入。

我们首先需要确定接入模型的类型，并在对应供应商的目录下创建对应模型类型的 `module`。

当前支持模型类型如下：

- `llm` 文本生成模型
- `text_embedding` 文本 Embedding 模型
- `rerank` Rerank 模型
- `speech2text` 语音转文字
- `moderation` 审查

依旧以 `Anthropic` 为例，`Anthropic` 仅支持 LLM，因此在 `model_providers.anthropic` 创建一个 `llm` 为名称的 `module`。

对于预定义的模型，我们首先需要在 `llm` `module` 下创建以模型名为文件名称的 YAML 文件，如：`claude-2.1.yaml`。

#### 准备模型 YAML

```yaml
model: claude-2.1  # 模型标识
# 模型展示名称，可设置 en_US 英文、zh_Hans 中文两种语言，zh_Hans 不设置将默认使用 en_US。
# 也可不设置 label，则使用 model 标识内容。
label:
  en_US: claude-2.1
model_type: llm  # 模型类型，claude-2.1 为 LLM
features:  # 支持功能，agent-thought 为支持 Agent 推理，vision 为支持图片理解
- agent-thought
model_properties:  # 模型属性
  mode: chat  # LLM 模式，complete 文本补全模型，chat 对话模型
  context_size: 200000  # 支持最大上下文大小
parameter_rules:  # 模型调用参数规则，仅 LLM 需要提供
- name: temperature  # 调用参数变量名
  # 默认预置了 5 种变量内容配置模板，temperature/top_p/max_tokens/presence_penalty/frequency_penalty
  # 可在 use_template 中直接设置模板变量名，将会使用 entities.defaults.PARAMETER_RULE_TEMPLATE 中的默认配置
  # 若设置了额外的配置参数，将覆盖默认配置
  use_template: temperature
- name: top_p
  use_template: top_p
- name: top_k
  label:  # 调用参数展示名称
    zh_Hans: 取样数量
    en_US: Top k
  type: int  # 参数类型，支持 float/int/string/boolean
  help:  # 帮助信息，描述参数作用
    zh_Hans: 仅从每个后续标记的前 K 个选项中采样。
    en_US: Only sample from the top K options for each subsequent token.
  required: false  # 是否必填，可不设置
- name: max_tokens_to_sample
  use_template: max_tokens
  default: 4096  # 参数默认值
  min: 1  # 参数最小值，仅 float/int 可用
  max: 4096  # 参数最大值，仅 float/int 可用
pricing:  # 价格信息
  input: '8.00'  # 输入单价，即 Prompt 单价
  output: '24.00'  # 输出单价，即返回内容单价
  unit: '0.000001'  # 价格单位，即上述价格为每 100K 的单价
  currency: USD  # 价格货币
```

建议将所有模型配置都准备完毕后再开始模型代码的实现。

同样，也可以参考  `model_providers` 目录下其他供应商对应模型类型目录下的 YAML 配置信息，完整的 YAML 规则见：[Schema](schema.md#AIModel)。

#### 实现模型调用代码

接下来需要在 `llm` `module` 下创建一个同名的 python 文件 `llm.py` 来编写代码实现。

在 `llm.py` 中创建一个 Anthropic LLM 类，我们取名为 `AnthropicLargeLanguageModel`（随意），继承 `__base.large_language_model.LargeLanguageModel` 基类，实现以下几个方法：

- LLM 调用

  实现 LLM 调用的核心方法，可同时支持流式和同步返回。

  ```python
  def _invoke(self, model: str, credentials: dict,
              prompt_messages: list[PromptMessage], model_parameters: dict,
              tools: Optional[list[PromptMessageTool]] = None, stop: Optional[List[str]] = None,
              stream: bool = True, user: Optional[str] = None) \
          -> Union[LLMResult, Generator]:
      """
      Invoke large language model
  
      :param model: model name
      :param credentials: model credentials
      :param prompt_messages: prompt messages
      :param model_parameters: model parameters
      :param tools: tools for tool calling
      :param stop: stop words
      :param stream: is stream response
      :param user: unique user id
      :return: full response or stream response chunk generator result
      """
  ```

- 预计算输入 tokens

  若模型未提供预计算 tokens 接口，可直接返回 0。

  ```python
  def get_num_tokens(self, model: str, prompt_messages: list[PromptMessage],
                     tools: Optional[list[PromptMessageTool]] = None) -> int:
      """
      Get number of tokens for given prompt messages
  
      :param model:
      :param prompt_messages:
      :param tools: tools for tool calling
      :return:
      """
  ```

- 模型凭据校验

  与供应商凭据校验类似，这里针对单个模型进行校验。

  ```python
  def validate_credentials(self, model: str, credentials: dict) -> None:
      """
      Validate model credentials
  
      :param model: model name
      :param credentials: model credentials
      :return:
      """
  ```

- 调用异常错误映射表

  当模型调用异常时需要映射到 Runtime 指定的 `InvokeError` 类型，方便 Dify 针对不同错误做不同后续处理。

  Runtime Errors:

  - `InvokeConnectionError` 调用连接错误
  - `InvokeServerUnavailableError ` 调用服务方不可用
  - `InvokeRateLimitError ` 调用达到限额
  - `InvokeAuthorizationError`  调用鉴权失败
  - `InvokeBadRequestError ` 调用传参有误

  ```python
  @property
  def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
      """
      Map model invoke error to unified error
      The key is the error type thrown to the caller
      The value is the error type thrown by the model,
      which needs to be converted into a unified error type for the caller.
  
      :return: Invoke error mapping
      """
  ```

接口方法说明见：[Interfaces](interfaces.md)，具体实现可参考：[llm.py](https://github.com/langgenius/dify-runtime/blob/main/lib/model_providers/anthropic/llm/llm.py)。

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
