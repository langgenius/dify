## 预定义模型接入

供应商集成完成后，接下来为供应商下模型的接入。

我们首先需要确定接入模型的类型，并在对应供应商的目录下创建对应模型类型的 `module`。

当前支持模型类型如下：

- `llm` 文本生成模型
- `text_embedding` 文本 Embedding 模型
- `rerank` Rerank 模型
- `speech2text` 语音转文字
- `tts` 文字转语音
- `moderation` 审查

依旧以 `Anthropic` 为例，`Anthropic` 仅支持 LLM，因此在 `model_providers.anthropic` 创建一个 `llm` 为名称的 `module`。

对于预定义的模型，我们首先需要在 `llm` `module` 下创建以模型名为文件名称的 YAML 文件，如：`claude-2.1.yaml`。

### 准备模型 YAML

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

同样，也可以参考 `model_providers` 目录下其他供应商对应模型类型目录下的 YAML 配置信息，完整的 YAML 规则见：[Schema](schema.md#aimodelentity)。

### 实现模型调用代码

接下来需要在 `llm` `module` 下创建一个同名的 python 文件 `llm.py` 来编写代码实现。

在 `llm.py` 中创建一个 Anthropic LLM 类，我们取名为 `AnthropicLargeLanguageModel`（随意），继承 `__base.large_language_model.LargeLanguageModel` 基类，实现以下几个方法：

- LLM 调用

  实现 LLM 调用的核心方法，可同时支持流式和同步返回。

  ```python
  def _invoke(self, model: str, credentials: dict,
              prompt_messages: list[PromptMessage], model_parameters: dict,
              tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
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

  在实现时，需要注意使用两个函数来返回数据，分别用于处理同步返回和流式返回，因为 Python 会将函数中包含 `yield` 关键字的函数识别为生成器函数，返回的数据类型固定为 `Generator`，因此同步和流式返回需要分别实现，就像下面这样（注意下面例子使用了简化参数，实际实现时需要按照上面的参数列表进行实现）：

  ```python
  def _invoke(self, stream: bool, **kwargs) \
          -> Union[LLMResult, Generator]:
      if stream:
            return self._handle_stream_response(**kwargs)
      return self._handle_sync_response(**kwargs)

  def _handle_stream_response(self, **kwargs) -> Generator:
      for chunk in response:
            yield chunk
  def _handle_sync_response(self, **kwargs) -> LLMResult:
      return LLMResult(**response)
  ```

- 预计算输入 tokens

  若模型未提供预计算 tokens 接口，可直接返回 0。

  ```python
  def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                     tools: Optional[list[PromptMessageTool]] = None) -> int:
      """
      Get number of tokens for given prompt messages

      :param model: model name
      :param credentials: model credentials
      :param prompt_messages: prompt messages
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
  - `InvokeAuthorizationError` 调用鉴权失败
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

接口方法说明见：[Interfaces](./interfaces.md)，具体实现可参考：[llm.py](https://github.com/langgenius/dify-runtime/blob/main/lib/model_providers/anthropic/llm/llm.py)。
