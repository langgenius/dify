## Predefined Model Integration

After completing the vendor integration, the next step is to integrate the models from the vendor.

First, we need to determine the type of model to be integrated and create the corresponding model type `module` under the respective vendor's directory.

Currently supported model types are:

- `llm` Text Generation Model
- `text_embedding` Text Embedding Model
- `rerank` Rerank Model
- `speech2text` Speech-to-Text
- `tts` Text-to-Speech
- `moderation` Moderation

Continuing with `Anthropic` as an example, `Anthropic` only supports LLM, so create a `module` named `llm` under `model_providers.anthropic`.

For predefined models, we first need to create a YAML file named after the model under the `llm` `module`, such as `claude-2.1.yaml`.

### Prepare Model YAML

```yaml
model: claude-2.1  # Model identifier
# Display name of the model, which can be set to en_US English or zh_Hans Chinese. If zh_Hans is not set, it will default to en_US.
# This can also be omitted, in which case the model identifier will be used as the label
label:
  en_US: claude-2.1
model_type: llm  # Model type, claude-2.1 is an LLM
features:  # Supported features, agent-thought supports Agent reasoning, vision supports image understanding
- agent-thought
model_properties:  # Model properties
  mode: chat  # LLM mode, complete for text completion models, chat for conversation models
  context_size: 200000  # Maximum context size
parameter_rules:  # Parameter rules for the model call; only LLM requires this
- name: temperature  # Parameter variable name
  # Five default configuration templates are provided: temperature/top_p/max_tokens/presence_penalty/frequency_penalty
  # The template variable name can be set directly in use_template, which will use the default configuration in entities.defaults.PARAMETER_RULE_TEMPLATE
  # Additional configuration parameters will override the default configuration if set
  use_template: temperature
- name: top_p
  use_template: top_p
- name: top_k
  label:  # Display name of the parameter
    zh_Hans: 取样数量
    en_US: Top k
  type: int  # Parameter type, supports float/int/string/boolean
  help:  # Help information, describing the parameter's function
    zh_Hans: 仅从每个后续标记的前 K 个选项中采样。
    en_US: Only sample from the top K options for each subsequent token.
  required: false  # Whether the parameter is mandatory; can be omitted
- name: max_tokens_to_sample
  use_template: max_tokens
  default: 4096  # Default value of the parameter
  min: 1  # Minimum value of the parameter, applicable to float/int only
  max: 4096  # Maximum value of the parameter, applicable to float/int only
pricing:  # Pricing information
  input: '8.00'  # Input unit price, i.e., prompt price
  output: '24.00'  # Output unit price, i.e., response content price
  unit: '0.000001'  # Price unit, meaning the above prices are per 100K
  currency: USD  # Price currency
```

It is recommended to prepare all model configurations before starting the implementation of the model code.

You can also refer to the YAML configuration information under the corresponding model type directories of other vendors in the `model_providers` directory. For the complete YAML rules, refer to: [Schema](schema.md#aimodelentity).

### Implement the Model Call Code

Next, create a Python file named `llm.py` under the `llm` `module` to write the implementation code.

Create an Anthropic LLM class named `AnthropicLargeLanguageModel` (or any other name), inheriting from the `__base.large_language_model.LargeLanguageModel` base class, and implement the following methods:

- LLM Call

Implement the core method for calling the LLM, supporting both streaming and synchronous responses.

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

Ensure to use two functions for returning data, one for synchronous returns and the other for streaming returns, because Python identifies functions containing the `yield` keyword as generator functions, fixing the return type to `Generator`. Thus, synchronous and streaming returns need to be implemented separately, as shown below (note that the example uses simplified parameters, for actual implementation follow the above parameter list):

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

- Pre-compute Input Tokens

If the model does not provide an interface to precompute tokens, return 0 directly.

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

- Validate Model Credentials

Similar to vendor credential validation, but specific to a single model.

```python
  def validate_credentials(self, model: str, credentials: dict) -> None:
      """
      Validate model credentials
  
      :param model: model name
      :param credentials: model credentials
      :return:
      """
```

- Map Invoke Errors

When a model call fails, map it to a specific `InvokeError` type as required by Runtime, allowing Dify to handle different errors accordingly.

Runtime Errors:

- `InvokeConnectionError` Connection error

- `InvokeServerUnavailableError` Service provider unavailable
- `InvokeRateLimitError` Rate limit reached
- `InvokeAuthorizationError` Authorization failed
- `InvokeBadRequestError` Parameter error

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

For interface method explanations, see: [Interfaces](./interfaces.md). For detailed implementation, refer to: [llm.py](https://github.com/langgenius/dify-runtime/blob/main/lib/model_providers/anthropic/llm/llm.py).