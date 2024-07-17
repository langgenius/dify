# 接口方法

这里介绍供应商和各模型类型需要实现的接口方法和参数说明。

## 供应商

继承 `__base.model_provider.ModelProvider` 基类，实现以下接口：

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

- `credentials` (object) 凭据信息

  凭据信息的参数由供应商 YAML 配置文件的 `provider_credential_schema` 定义，传入如：`api_key` 等。

验证失败请抛出 `errors.validate.CredentialsValidateFailedError` 错误。

**注：预定义模型需完整实现该接口，自定义模型供应商只需要如下简单实现即可**

```python
class XinferenceProvider(Provider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        pass
```

## 模型

模型分为 5 种不同的模型类型，不同模型类型继承的基类不同，需要实现的方法也不同。

### 通用接口

所有模型均需要统一实现下面 2 个方法：

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

  参数：

  - `model` (string) 模型名称

  - `credentials` (object) 凭据信息

    凭据信息的参数由供应商 YAML 配置文件的 `provider_credential_schema` 或 `model_credential_schema` 定义，传入如：`api_key` 等。

  验证失败请抛出 `errors.validate.CredentialsValidateFailedError` 错误。

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

  也可以直接抛出对应Erros，并做如下定义，这样在之后的调用中可以直接抛出`InvokeConnectionError`等异常。
  
    ```python
    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeConnectionError: [
              InvokeConnectionError
            ],
            InvokeServerUnavailableError: [
              InvokeServerUnavailableError
            ],
            InvokeRateLimitError: [
              InvokeRateLimitError
            ],
            InvokeAuthorizationError: [
              InvokeAuthorizationError
            ],
            InvokeBadRequestError: [
              InvokeBadRequestError
            ],
        }
    ```

​	可参考 OpenAI `_invoke_error_mapping`。  

### LLM

继承 `__base.large_language_model.LargeLanguageModel` 基类，实现以下接口：

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

  - 参数：

    - `model` (string) 模型名称

    - `credentials` (object) 凭据信息
    
      凭据信息的参数由供应商 YAML 配置文件的 `provider_credential_schema` 或 `model_credential_schema` 定义，传入如：`api_key` 等。

    - `prompt_messages` (array[[PromptMessage](#PromptMessage)]) Prompt 列表
    
      若模型为 `Completion` 类型，则列表只需要传入一个 [UserPromptMessage](#UserPromptMessage) 元素即可；
    
      若模型为 `Chat` 类型，需要根据消息不同传入 [SystemPromptMessage](#SystemPromptMessage), [UserPromptMessage](#UserPromptMessage), [AssistantPromptMessage](#AssistantPromptMessage), [ToolPromptMessage](#ToolPromptMessage) 元素列表

    - `model_parameters` (object) 模型参数
    
      模型参数由模型 YAML 配置的 `parameter_rules` 定义。

    - `tools` (array[[PromptMessageTool](#PromptMessageTool)]) [optional] 工具列表，等同于 `function calling` 中的 `function`。
    
      即传入 tool calling 的工具列表。

    - `stop` (array[string]) [optional] 停止序列
    
      模型返回将在停止序列定义的字符串之前停止输出。

    - `stream` (bool) 是否流式输出，默认 True
    
      流式输出返回 Generator[[LLMResultChunk](#LLMResultChunk)]，非流式输出返回 [LLMResult](#LLMResult)。

    - `user` (string) [optional] 用户的唯一标识符
    
      可以帮助供应商监控和检测滥用行为。

  - 返回

    流式输出返回 Generator[[LLMResultChunk](#LLMResultChunk)]，非流式输出返回 [LLMResult](#LLMResult)。

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

  参数说明见上述 `LLM 调用`。

  该接口需要根据对应`model`选择合适的`tokenizer`进行计算，如果对应模型没有提供`tokenizer`，可以使用`AIModel`基类中的`_get_num_tokens_by_gpt2(text: str)`方法进行计算。

- 获取自定义模型规则 [可选]

  ```python
  def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
      """
      Get customizable model schema

      :param model: model name
      :param credentials: model credentials
      :return: model schema
      """
  ```

​当供应商支持增加自定义 LLM 时，可实现此方法让自定义模型可获取模型规则，默认返回 None。

对于`OpenAI`供应商下的大部分微调模型，可以通过其微调模型名称获取到其基类模型，如`gpt-3.5-turbo-1106`，然后返回基类模型的预定义参数规则，参考[openai](https://github.com/langgenius/dify/blob/feat/model-runtime/api/core/model_runtime/model_providers/openai/llm/llm.py#L801)
的具体实现

### TextEmbedding

继承 `__base.text_embedding_model.TextEmbeddingModel` 基类，实现以下接口：

- Embedding 调用

  ```python
  def _invoke(self, model: str, credentials: dict,
              texts: list[str], user: Optional[str] = None) \
          -> TextEmbeddingResult:
      """
      Invoke large language model
  
      :param model: model name
      :param credentials: model credentials
      :param texts: texts to embed
      :param user: unique user id
      :return: embeddings result
      """
  ```

  - 参数：

    - `model` (string) 模型名称

    - `credentials` (object) 凭据信息

      凭据信息的参数由供应商 YAML 配置文件的 `provider_credential_schema` 或 `model_credential_schema` 定义，传入如：`api_key` 等。

    - `texts` (array[string]) 文本列表，可批量处理

    - `user` (string) [optional] 用户的唯一标识符

      可以帮助供应商监控和检测滥用行为。

  - 返回：

    [TextEmbeddingResult](#TextEmbeddingResult) 实体。

- 预计算 tokens

  ```python
  def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
      """
      Get number of tokens for given prompt messages

      :param model: model name
      :param credentials: model credentials
      :param texts: texts to embed
      :return:
      """
  ```

  参数说明见上述 `Embedding 调用`。

  同上述`LargeLanguageModel`，该接口需要根据对应`model`选择合适的`tokenizer`进行计算，如果对应模型没有提供`tokenizer`，可以使用`AIModel`基类中的`_get_num_tokens_by_gpt2(text: str)`方法进行计算。

### Rerank

继承 `__base.rerank_model.RerankModel` 基类，实现以下接口：

- rerank 调用

  ```python
  def _invoke(self, model: str, credentials: dict,
              query: str, docs: list[str], score_threshold: Optional[float] = None, top_n: Optional[int] = None,
              user: Optional[str] = None) \
          -> RerankResult:
      """
      Invoke rerank model
  
      :param model: model name
      :param credentials: model credentials
      :param query: search query
      :param docs: docs for reranking
      :param score_threshold: score threshold
      :param top_n: top n
      :param user: unique user id
      :return: rerank result
      """
  ```

  - 参数：

    - `model` (string) 模型名称

    - `credentials` (object) 凭据信息

      凭据信息的参数由供应商 YAML 配置文件的 `provider_credential_schema` 或 `model_credential_schema` 定义，传入如：`api_key` 等。

    - `query` (string) 查询请求内容

    - `docs` (array[string]) 需要重排的分段列表

    - `score_threshold` (float) [optional] Score 阈值

    - `top_n` (int) [optional] 取前 n 个分段

    - `user` (string) [optional] 用户的唯一标识符

      可以帮助供应商监控和检测滥用行为。

  - 返回：

    [RerankResult](#RerankResult) 实体。

### Speech2text

继承 `__base.speech2text_model.Speech2TextModel` 基类，实现以下接口：

- Invoke 调用

  ```python
  def _invoke(self, model: str, credentials: dict,
              file: IO[bytes], user: Optional[str] = None) \
          -> str:
      """
      Invoke large language model
  
      :param model: model name
      :param credentials: model credentials
      :param file: audio file
      :param user: unique user id
      :return: text for given audio file
      """	
  ```

  - 参数：

    - `model` (string) 模型名称

    - `credentials` (object) 凭据信息

      凭据信息的参数由供应商 YAML 配置文件的 `provider_credential_schema` 或 `model_credential_schema` 定义，传入如：`api_key` 等。

    - `file` (File) 文件流

    - `user` (string) [optional] 用户的唯一标识符

      可以帮助供应商监控和检测滥用行为。

  - 返回：

    语音转换后的字符串。

### Text2speech

继承 `__base.text2speech_model.Text2SpeechModel` 基类，实现以下接口：

- Invoke 调用

  ```python
  def _invoke(self, model: str, credentials: dict, content_text: str, streaming: bool, user: Optional[str] = None):
      """
      Invoke large language model
  
      :param model: model name
      :param credentials: model credentials
      :param content_text: text content to be translated
      :param streaming: output is streaming
      :param user: unique user id
      :return: translated audio file
      """	
  ```

  - 参数：

    - `model` (string) 模型名称

    - `credentials` (object) 凭据信息

      凭据信息的参数由供应商 YAML 配置文件的 `provider_credential_schema` 或 `model_credential_schema` 定义，传入如：`api_key` 等。

    - `content_text` (string) 需要转换的文本内容

    - `streaming` (bool) 是否进行流式输出

    - `user` (string) [optional] 用户的唯一标识符

      可以帮助供应商监控和检测滥用行为。

  - 返回：

    文本转换后的语音流。

### Moderation

继承 `__base.moderation_model.ModerationModel` 基类，实现以下接口：

- Invoke 调用

  ```python
  def _invoke(self, model: str, credentials: dict,
              text: str, user: Optional[str] = None) \
          -> bool:
      """
      Invoke large language model
  
      :param model: model name
      :param credentials: model credentials
      :param text: text to moderate
      :param user: unique user id
      :return: false if text is safe, true otherwise
      """
  ```

  - 参数：

    - `model` (string) 模型名称

    - `credentials` (object) 凭据信息

      凭据信息的参数由供应商 YAML 配置文件的 `provider_credential_schema` 或 `model_credential_schema` 定义，传入如：`api_key` 等。

    - `text` (string) 文本内容

    - `user` (string) [optional] 用户的唯一标识符

      可以帮助供应商监控和检测滥用行为。

  - 返回：

    False 代表传入的文本安全，True 则反之。



## 实体

### PromptMessageRole 

消息角色

```python
class PromptMessageRole(Enum):
    """
    Enum class for prompt message.
    """
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"
```

### PromptMessageContentType

消息内容类型，分为纯文本和图片。

```python
class PromptMessageContentType(Enum):
    """
    Enum class for prompt message content type.
    """
    TEXT = 'text'
    IMAGE = 'image'
```

### PromptMessageContent

消息内容基类，仅作为参数声明用，不可初始化。

```python
class PromptMessageContent(BaseModel):
    """
    Model class for prompt message content.
    """
    type: PromptMessageContentType
    data: str  # 内容数据
```

当前支持文本和图片两种类型，可支持同时传入文本和多图。

需要分别初始化 `TextPromptMessageContent` 和 `ImagePromptMessageContent` 传入。

### TextPromptMessageContent

```python
class TextPromptMessageContent(PromptMessageContent):
    """
    Model class for text prompt message content.
    """
    type: PromptMessageContentType = PromptMessageContentType.TEXT
```

若传入图文，其中文字需要构造此实体作为 `content` 列表中的一部分。

### ImagePromptMessageContent

```python
class ImagePromptMessageContent(PromptMessageContent):
    """
    Model class for image prompt message content.
    """
    class DETAIL(Enum):
        LOW = 'low'
        HIGH = 'high'

    type: PromptMessageContentType = PromptMessageContentType.IMAGE
    detail: DETAIL = DETAIL.LOW  # 分辨率
```

若传入图文，其中图片需要构造此实体作为 `content` 列表中的一部分

`data` 可以为 `url` 或者图片 `base64` 加密后的字符串。

### PromptMessage

所有 Role 消息体的基类，仅作为参数声明用，不可初始化。

```python
class PromptMessage(ABC, BaseModel):
    """
    Model class for prompt message.
    """
    role: PromptMessageRole  # 消息角色
    content: Optional[str | list[PromptMessageContent]] = None  # 支持两种类型，字符串和内容列表，内容列表是为了满足多模态的需要，可详见 PromptMessageContent 说明。
    name: Optional[str] = None  # 名称，可选。
```

### UserPromptMessage

UserMessage 消息体，代表用户消息。

```python
class UserPromptMessage(PromptMessage):
    """
    Model class for user prompt message.
    """
    role: PromptMessageRole = PromptMessageRole.USER
```

### AssistantPromptMessage

代表模型返回消息，通常用于 `few-shots` 或聊天历史传入。

```python
class AssistantPromptMessage(PromptMessage):
    """
    Model class for assistant prompt message.
    """
    class ToolCall(BaseModel):
        """
        Model class for assistant prompt message tool call.
        """
        class ToolCallFunction(BaseModel):
            """
            Model class for assistant prompt message tool call function.
            """
            name: str  # 工具名称
            arguments: str  # 工具参数

        id: str  # 工具 ID，仅在 OpenAI tool call 生效，为工具调用的唯一 ID，同一个工具可以调用多次
        type: str  # 默认 function
        function: ToolCallFunction  # 工具调用信息

    role: PromptMessageRole = PromptMessageRole.ASSISTANT
    tool_calls: list[ToolCall] = []  # 模型回复的工具调用结果（仅当传入 tools，并且模型认为需要调用工具时返回）
```

其中 `tool_calls` 为调用模型传入 `tools` 后，由模型返回的 `tool call` 列表。

### SystemPromptMessage

代表系统消息，通常用于设定给模型的系统指令。

```python
class SystemPromptMessage(PromptMessage):
    """
    Model class for system prompt message.
    """
    role: PromptMessageRole = PromptMessageRole.SYSTEM
```

### ToolPromptMessage

代表工具消息，用于工具执行后将结果交给模型进行下一步计划。

```python
class ToolPromptMessage(PromptMessage):
    """
    Model class for tool prompt message.
    """
    role: PromptMessageRole = PromptMessageRole.TOOL
    tool_call_id: str  # 工具调用 ID，若不支持 OpenAI tool call，也可传入工具名称
```

基类的 `content` 传入工具执行结果。

### PromptMessageTool

```python
class PromptMessageTool(BaseModel):
    """
    Model class for prompt message tool.
    """
    name: str  # 工具名称
    description: str  # 工具描述
    parameters: dict  # 工具参数 dict
```

---

### LLMResult

```python
class LLMResult(BaseModel):
    """
    Model class for llm result.
    """
    model: str  # 实际使用模型
    prompt_messages: list[PromptMessage]  # prompt 消息列表
    message: AssistantPromptMessage  # 回复消息
    usage: LLMUsage  # 使用的 tokens 及费用信息
    system_fingerprint: Optional[str] = None  # 请求指纹，可参考 OpenAI 该参数定义
```

### LLMResultChunkDelta

流式返回中每个迭代内部 `delta` 实体

```python
class LLMResultChunkDelta(BaseModel):
    """
    Model class for llm result chunk delta.
    """
    index: int  # 序号
    message: AssistantPromptMessage  # 回复消息
    usage: Optional[LLMUsage] = None  # 使用的 tokens 及费用信息，仅最后一条返回
    finish_reason: Optional[str] = None  # 结束原因，仅最后一条返回
```

### LLMResultChunk

流式返回中每个迭代实体

```python
class LLMResultChunk(BaseModel):
    """
    Model class for llm result chunk.
    """
    model: str  # 实际使用模型
    prompt_messages: list[PromptMessage]  # prompt 消息列表
    system_fingerprint: Optional[str] = None  # 请求指纹，可参考 OpenAI 该参数定义
    delta: LLMResultChunkDelta  # 每个迭代存在变化的内容
```

### LLMUsage

```python
class LLMUsage(ModelUsage):
    """
    Model class for llm usage.
    """
    prompt_tokens: int  # prompt 使用 tokens
    prompt_unit_price: Decimal  # prompt 单价
    prompt_price_unit: Decimal  # prompt 价格单位，即单价基于多少 tokens 
    prompt_price: Decimal  # prompt 费用
    completion_tokens: int  # 回复使用 tokens
    completion_unit_price: Decimal  # 回复单价
    completion_price_unit: Decimal  # 回复价格单位，即单价基于多少 tokens 
    completion_price: Decimal  # 回复费用
    total_tokens: int  # 总使用 token 数
    total_price: Decimal  # 总费用
    currency: str  # 货币单位
    latency: float  # 请求耗时(s)
```

---

### TextEmbeddingResult

```python
class TextEmbeddingResult(BaseModel):
    """
    Model class for text embedding result.
    """
    model: str  # 实际使用模型
    embeddings: list[list[float]]  # embedding 向量列表，对应传入的 texts 列表
    usage: EmbeddingUsage  # 使用信息
```

### EmbeddingUsage

```python
class EmbeddingUsage(ModelUsage):
    """
    Model class for embedding usage.
    """
    tokens: int  # 使用 token 数
    total_tokens: int  # 总使用 token 数
    unit_price: Decimal  # 单价
    price_unit: Decimal  # 价格单位，即单价基于多少 tokens
    total_price: Decimal  # 总费用
    currency: str  # 货币单位
    latency: float  # 请求耗时(s)
```

---

### RerankResult

```python
class RerankResult(BaseModel):
    """
    Model class for rerank result.
    """
    model: str  # 实际使用模型
    docs: list[RerankDocument]  # 重排后的分段列表	
```

### RerankDocument

```python
class RerankDocument(BaseModel):
    """
    Model class for rerank document.
    """
    index: int  # 原序号
    text: str  # 分段文本内容
    score: float  # 分数
```
