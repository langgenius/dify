# Interface Methods

This section describes the interface methods and parameter explanations that need to be implemented by providers and various model types.

## Provider

Inherit the `__base.model_provider.ModelProvider` base class and implement the following interfaces:

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

- `credentials` (object) Credential information

  The parameters of credential information are defined by the `provider_credential_schema` in the provider's YAML configuration file. Inputs such as `api_key` are included.

If verification fails, throw the `errors.validate.CredentialsValidateFailedError` error.

## Model

Models are divided into 5 different types, each inheriting from different base classes and requiring the implementation of different methods.

All models need to uniformly implement the following 2 methods:

- Model Credential Verification

  Similar to provider credential verification, this step involves verification for an individual model.

  ```python
  def validate_credentials(self, model: str, credentials: dict) -> None:
      """
      Validate model credentials

      :param model: model name
      :param credentials: model credentials
      :return:
      """
  ```

  Parameters:

  - `model` (string) Model name

  - `credentials` (object) Credential information

    The parameters of credential information are defined by either the `provider_credential_schema` or `model_credential_schema` in the provider's YAML configuration file. Inputs such as `api_key` are included.

  If verification fails, throw the `errors.validate.CredentialsValidateFailedError` error.

- Invocation Error Mapping Table

  When there is an exception in model invocation, it needs to be mapped to the `InvokeError` type specified by Runtime. This facilitates Dify's ability to handle different errors with appropriate follow-up actions.

  Runtime Errors:

  - `InvokeConnectionError` Invocation connection error
  - `InvokeServerUnavailableError` Invocation service provider unavailable
  - `InvokeRateLimitError` Invocation reached rate limit
  - `InvokeAuthorizationError` Invocation authorization failure
  - `InvokeBadRequestError` Invocation parameter error

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

​ You can refer to OpenAI's `_invoke_error_mapping` for an example.

### LLM

Inherit the `__base.large_language_model.LargeLanguageModel` base class and implement the following interfaces:

- LLM Invocation

  Implement the core method for LLM invocation, which can support both streaming and synchronous returns.

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

  - Parameters:

    - `model` (string) Model name

    - `credentials` (object) Credential information

      The parameters of credential information are defined by either the `provider_credential_schema` or `model_credential_schema` in the provider's YAML configuration file. Inputs such as `api_key` are included.

    - `prompt_messages` (array\[[PromptMessage](#PromptMessage)\]) List of prompts

      If the model is of the `Completion` type, the list only needs to include one [UserPromptMessage](#UserPromptMessage) element;

      If the model is of the `Chat` type, it requires a list of elements such as [SystemPromptMessage](#SystemPromptMessage), [UserPromptMessage](#UserPromptMessage), [AssistantPromptMessage](#AssistantPromptMessage), [ToolPromptMessage](#ToolPromptMessage) depending on the message.

    - `model_parameters` (object) Model parameters

      The model parameters are defined by the `parameter_rules` in the model's YAML configuration.

    - `tools` (array\[[PromptMessageTool](#PromptMessageTool)\]) [optional] List of tools, equivalent to the `function` in `function calling`.

      That is, the tool list for tool calling.

    - `stop` (array[string]) [optional] Stop sequences

      The model output will stop before the string defined by the stop sequence.

    - `stream` (bool) Whether to output in a streaming manner, default is True

      Streaming output returns Generator\[[LLMResultChunk](#LLMResultChunk)\], non-streaming output returns [LLMResult](#LLMResult).

    - `user` (string) [optional] Unique identifier of the user

      This can help the provider monitor and detect abusive behavior.

  - Returns

    Streaming output returns Generator\[[LLMResultChunk](#LLMResultChunk)\], non-streaming output returns [LLMResult](#LLMResult).

- Pre-calculating Input Tokens

  If the model does not provide a pre-calculated tokens interface, you can directly return 0.

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

  For parameter explanations, refer to the above section on `LLM Invocation`.

- Fetch Custom Model Schema [Optional]

  ```python
  def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
      """
      Get customizable model schema

      :param model: model name
      :param credentials: model credentials
      :return: model schema
      """
  ```

  When the provider supports adding custom LLMs, this method can be implemented to allow custom models to fetch model schema. The default return null.

### TextEmbedding

Inherit the `__base.text_embedding_model.TextEmbeddingModel` base class and implement the following interfaces:

- Embedding Invocation

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

  - Parameters:

    - `model` (string) Model name

    - `credentials` (object) Credential information

      The parameters of credential information are defined by either the `provider_credential_schema` or `model_credential_schema` in the provider's YAML configuration file. Inputs such as `api_key` are included.

    - `texts` (array[string]) List of texts, capable of batch processing

    - `user` (string) [optional] Unique identifier of the user

      This can help the provider monitor and detect abusive behavior.

  - Returns:

    [TextEmbeddingResult](#TextEmbeddingResult) entity.

- Pre-calculating Tokens

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

  For parameter explanations, refer to the above section on `Embedding Invocation`.

### Rerank

Inherit the `__base.rerank_model.RerankModel` base class and implement the following interfaces:

- Rerank Invocation

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

  - Parameters:

    - `model` (string) Model name

    - `credentials` (object) Credential information

      The parameters of credential information are defined by either the `provider_credential_schema` or `model_credential_schema` in the provider's YAML configuration file. Inputs such as `api_key` are included.

    - `query` (string) Query request content

    - `docs` (array[string]) List of segments to be reranked

    - `score_threshold` (float) [optional] Score threshold

    - `top_n` (int) [optional] Select the top n segments

    - `user` (string) [optional] Unique identifier of the user

      This can help the provider monitor and detect abusive behavior.

  - Returns:

    [RerankResult](#RerankResult) entity.

### Speech2text

Inherit the `__base.speech2text_model.Speech2TextModel` base class and implement the following interfaces:

- Invoke Invocation

  ```python
  def _invoke(self, model: str, credentials: dict, file: IO[bytes], user: Optional[str] = None) -> str:
      """
      Invoke large language model

      :param model: model name
      :param credentials: model credentials
      :param file: audio file
      :param user: unique user id
      :return: text for given audio file
      """	
  ```

  - Parameters:

    - `model` (string) Model name

    - `credentials` (object) Credential information

      The parameters of credential information are defined by either the `provider_credential_schema` or `model_credential_schema` in the provider's YAML configuration file. Inputs such as `api_key` are included.

    - `file` (File) File stream

    - `user` (string) [optional] Unique identifier of the user

      This can help the provider monitor and detect abusive behavior.

  - Returns:

    The string after speech-to-text conversion.

### Text2speech

Inherit the `__base.text2speech_model.Text2SpeechModel` base class and implement the following interfaces:

- Invoke Invocation

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

  - Parameters：

    - `model` (string) Model name

    - `credentials` (object) Credential information

      The parameters of credential information are defined by either the `provider_credential_schema` or `model_credential_schema` in the provider's YAML configuration file. Inputs such as `api_key` are included.

    - `content_text` (string) The text content that needs to be converted

    - `streaming` (bool) Whether to stream output

    - `user` (string) [optional] Unique identifier of the user

      This can help the provider monitor and detect abusive behavior.

  - Returns：

    Text converted speech stream.

### Moderation

Inherit the `__base.moderation_model.ModerationModel` base class and implement the following interfaces:

- Invoke Invocation

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

  - Parameters:

    - `model` (string) Model name

    - `credentials` (object) Credential information

      The parameters of credential information are defined by either the `provider_credential_schema` or `model_credential_schema` in the provider's YAML configuration file. Inputs such as `api_key` are included.

    - `text` (string) Text content

    - `user` (string) [optional] Unique identifier of the user

      This can help the provider monitor and detect abusive behavior.

  - Returns:

    False indicates that the input text is safe, True indicates otherwise.

## Entities

### PromptMessageRole

Message role

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

Message content types, divided into text and image.

```python
class PromptMessageContentType(Enum):
    """
    Enum class for prompt message content type.
    """
    TEXT = 'text'
    IMAGE = 'image'
```

### PromptMessageContent

Message content base class, used only for parameter declaration and cannot be initialized.

```python
class PromptMessageContent(BaseModel):
    """
    Model class for prompt message content.
    """
    type: PromptMessageContentType
    data: str
```

Currently, two types are supported: text and image. It's possible to simultaneously input text and multiple images.

You need to initialize `TextPromptMessageContent` and `ImagePromptMessageContent` separately for input.

### TextPromptMessageContent

```python
class TextPromptMessageContent(PromptMessageContent):
    """
    Model class for text prompt message content.
    """
    type: PromptMessageContentType = PromptMessageContentType.TEXT
```

If inputting a combination of text and images, the text needs to be constructed into this entity as part of the `content` list.

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
    detail: DETAIL = DETAIL.LOW  # Resolution
```

If inputting a combination of text and images, the images need to be constructed into this entity as part of the `content` list.

`data` can be either a `url` or a `base64` encoded string of the image.

### PromptMessage

The base class for all Role message bodies, used only for parameter declaration and cannot be initialized.

```python
class PromptMessage(BaseModel):
    """
    Model class for prompt message.
    """
    role: PromptMessageRole
    content: Optional[str | list[PromptMessageContent]] = None  # Supports two types: string and content list. The content list is designed to meet the needs of multimodal inputs. For more details, see the PromptMessageContent explanation.
    name: Optional[str] = None
```

### UserPromptMessage

UserMessage message body, representing a user's message.

```python
class UserPromptMessage(PromptMessage):
    """
    Model class for user prompt message.
    """
    role: PromptMessageRole = PromptMessageRole.USER
```

### AssistantPromptMessage

Represents a message returned by the model, typically used for `few-shots` or inputting chat history.

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
            name: str  # tool name
            arguments: str  # tool arguments

        id: str  # Tool ID, effective only in OpenAI tool calls. It's the unique ID for tool invocation and the same tool can be called multiple times.
        type: str  # default: function
        function: ToolCallFunction  # tool call information

    role: PromptMessageRole = PromptMessageRole.ASSISTANT
    tool_calls: list[ToolCall] = []  # The result of tool invocation in response from the model (returned only when tools are input and the model deems it necessary to invoke a tool).
```

Where `tool_calls` are the list of `tool calls` returned by the model after invoking the model with the `tools` input.

### SystemPromptMessage

Represents system messages, usually used for setting system commands given to the model.

```python
class SystemPromptMessage(PromptMessage):
    """
    Model class for system prompt message.
    """
    role: PromptMessageRole = PromptMessageRole.SYSTEM
```

### ToolPromptMessage

Represents tool messages, used for conveying the results of a tool execution to the model for the next step of processing.

```python
class ToolPromptMessage(PromptMessage):
    """
    Model class for tool prompt message.
    """
    role: PromptMessageRole = PromptMessageRole.TOOL
    tool_call_id: str  # Tool invocation ID. If OpenAI tool call is not supported, the name of the tool can also be inputted.
```

The base class's `content` takes in the results of tool execution.

### PromptMessageTool

```python
class PromptMessageTool(BaseModel):
    """
    Model class for prompt message tool.
    """
    name: str
    description: str
    parameters: dict
```

______________________________________________________________________

### LLMResult

```python
class LLMResult(BaseModel):
    """
    Model class for llm result.
    """
    model: str  # Actual used modele
    prompt_messages: list[PromptMessage]  # prompt messages
    message: AssistantPromptMessage  # response message
    usage: LLMUsage  # usage info
    system_fingerprint: Optional[str] = None  # request fingerprint, refer to OpenAI definition
```

### LLMResultChunkDelta

In streaming returns, each iteration contains the `delta` entity.

```python
class LLMResultChunkDelta(BaseModel):
    """
    Model class for llm result chunk delta.
    """
    index: int
    message: AssistantPromptMessage  # response message
    usage: Optional[LLMUsage] = None  # usage info
    finish_reason: Optional[str] = None  # finish reason, only the last one returns
```

### LLMResultChunk

Each iteration entity in streaming returns.

```python
class LLMResultChunk(BaseModel):
    """
    Model class for llm result chunk.
    """
    model: str  # Actual used modele
    prompt_messages: list[PromptMessage]  # prompt messages
    system_fingerprint: Optional[str] = None  # request fingerprint, refer to OpenAI definition
    delta: LLMResultChunkDelta
```

### LLMUsage

```python
class LLMUsage(ModelUsage):
    """
    Model class for LLM usage.
    """
    prompt_tokens: int  # Tokens used for prompt
    prompt_unit_price: Decimal  # Unit price for prompt
    prompt_price_unit: Decimal  # Price unit for prompt, i.e., the unit price based on how many tokens
    prompt_price: Decimal  # Cost for prompt
    completion_tokens: int  # Tokens used for response
    completion_unit_price: Decimal  # Unit price for response
    completion_price_unit: Decimal  # Price unit for response, i.e., the unit price based on how many tokens
    completion_price: Decimal  # Cost for response
    total_tokens: int  # Total number of tokens used
    total_price: Decimal  # Total cost
    currency: str  # Currency unit
    latency: float  # Request latency (s)
```

______________________________________________________________________

### TextEmbeddingResult

```python
class TextEmbeddingResult(BaseModel):
    """
    Model class for text embedding result.
    """
    model: str  # Actual model used
    embeddings: list[list[float]]  # List of embedding vectors, corresponding to the input texts list
    usage: EmbeddingUsage  # Usage information
```

### EmbeddingUsage

```python
class EmbeddingUsage(ModelUsage):
    """
    Model class for embedding usage.
    """
    tokens: int  # Number of tokens used
    total_tokens: int  # Total number of tokens used
    unit_price: Decimal  # Unit price
    price_unit: Decimal  # Price unit, i.e., the unit price based on how many tokens
    total_price: Decimal  # Total cost
    currency: str  # Currency unit
    latency: float  # Request latency (s)
```

______________________________________________________________________

### RerankResult

```python
class RerankResult(BaseModel):
    """
    Model class for rerank result.
    """
    model: str  # Actual model used
    docs: list[RerankDocument]  # Reranked document list	
```

### RerankDocument

```python
class RerankDocument(BaseModel):
    """
    Model class for rerank document.
    """
    index: int  # original index
    text: str
    score: float
```
