## Adding a New Provider

Providers support three types of model configuration methods:

- `predefined-model` Predefined model

  This indicates that users only need to configure the unified provider credentials to use the predefined models under the provider.

- `customizable-model` Customizable model

  Users need to add credential configurations for each model.

- `fetch-from-remote` Fetch from remote

  This is consistent with the `predefined-model` configuration method. Only unified provider credentials need to be configured, and models are obtained from the provider through credential information.

These three configuration methods **can coexist**, meaning a provider can support `predefined-model` + `customizable-model` or `predefined-model` + `fetch-from-remote`, etc. In other words, configuring the unified provider credentials allows the use of predefined and remotely fetched models, and if new models are added, they can be used in addition to the custom models.

## Getting Started

Adding a new provider starts with determining the English identifier of the provider, such as `anthropic`, and using this identifier to create a `module` in `model_providers`.

Under this `module`, we first need to prepare the provider's YAML configuration.

### Preparing Provider YAML

Here, using `Anthropic` as an example, we preset the provider's basic information, supported model types, configuration methods, and credential rules.

```YAML
provider: anthropic  # Provider identifier
label:  # Provider display name, can be set in en_US English and zh_Hans Chinese, zh_Hans will default to en_US if not set.
  en_US: Anthropic
icon_small:  # Small provider icon, stored in the _assets directory under the corresponding provider implementation directory, same language strategy as label
  en_US: icon_s_en.png
icon_large:  # Large provider icon, stored in the _assets directory under the corresponding provider implementation directory, same language strategy as label
  en_US: icon_l_en.png
supported_model_types:  # Supported model types, Anthropic only supports LLM
- llm
configurate_methods:  # Supported configuration methods, Anthropic only supports predefined models
- predefined-model
provider_credential_schema:  # Provider credential rules, as Anthropic only supports predefined models, unified provider credential rules need to be defined
  credential_form_schemas:  # List of credential form items
  - variable: anthropic_api_key  # Credential parameter variable name
    label:  # Display name
      en_US: API Key
    type: secret-input  # Form type, here secret-input represents an encrypted information input box, showing masked information when editing.
    required: true  # Whether required
    placeholder:  # Placeholder information
      zh_Hans: Enter your API Key here
      en_US: Enter your API Key
  - variable: anthropic_api_url
    label:
      en_US: API URL
    type: text-input  # Form type, here text-input represents a text input box
    required: false
    placeholder:
      zh_Hans: Enter your API URL here
      en_US: Enter your API URL
```

You can also refer to the YAML configuration information under other provider directories in `model_providers`. The complete YAML rules are available at: [Schema](schema.md#provider).

### Implementing Provider Code

Providers need to inherit the `__base.model_provider.ModelProvider` base class and implement the `validate_provider_credentials` method for unified provider credential verification. For reference, see [AnthropicProvider](https://github.com/langgenius/dify-runtime/blob/main/lib/model_providers/anthropic/anthropic.py).
> If the provider is the type of `customizable-model`, there is no need to implement the `validate_provider_credentials` method.

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

Of course, you can also preliminarily reserve the implementation of `validate_provider_credentials` and directly reuse it after the model credential verification method is implemented.

---

### Adding Models

After the provider integration is complete, the next step is to integrate models under the provider.

First, we need to determine the type of the model to be integrated and create a `module` for the corresponding model type in the provider's directory.

The currently supported model types are as follows:

- `llm` Text generation model
- `text_embedding` Text Embedding model
- `rerank` Rerank model
- `speech2text` Speech to text
- `tts` Text to speech
- `moderation` Moderation

Continuing with `Anthropic` as an example, since `Anthropic` only supports LLM, we create a `module` named `llm` in `model_providers.anthropic`.

For predefined models, we first need to create a YAML file named after the model, such as `claude-2.1.yaml`, under the `llm` `module`.

#### Preparing Model YAML

```yaml
model: claude-2.1  # Model identifier
# Model display name, can be set in en_US English and zh_Hans Chinese, zh_Hans will default to en_US if not set.
# Alternatively, if the label is not set, use the model identifier content.
label:
  en_US: claude-2.1
model_type: llm  # Model type, claude-2.1 is an LLM
features:  # Supported features, agent-thought for Agent reasoning, vision for image understanding
- agent-thought
model_properties:  # Model properties
  mode: chat  # LLM mode, complete for text completion model, chat for dialogue model
  context_size: 200000  # Maximum supported context size
parameter_rules:  # Model invocation parameter rules, only required for LLM
- name: temperature  # Invocation parameter variable name
  # Default preset with 5 variable content configuration templates: temperature/top_p/max_tokens/presence_penalty/frequency_penalty
  # Directly set the template variable name in use_template, which will use the default configuration in entities.defaults.PARAMETER_RULE_TEMPLATE
  # If additional configuration parameters are set, they will override the default configuration
  use_template: temperature
- name: top_p
  use_template: top_p
- name: top_k
  label:  # Invocation parameter display name
    zh_Hans: Sampling quantity
    en_US: Top k
  type: int  # Parameter type, supports float/int/string/boolean
  help:  # Help information, describing the role of the parameter
    zh_Hans: Only sample from the top K options for each subsequent token.
    en_US: Only sample from the top K options for each subsequent token.
  required: false  # Whether required, can be left unset
- name: max_tokens_to_sample
  use_template: max_tokens
  default: 4096  # Default parameter value
  min: 1  # Minimum parameter value, only applicable for float/int
  max: 4096  # Maximum parameter value, only applicable for float/int
pricing:  # Pricing information
  input: '8.00'  # Input price, i.e., Prompt price
  output: '24.00'  # Output price, i.e., returned content price
  unit: '0.000001'  # Pricing unit, i.e., the above prices are per 100K
  currency: USD  # Currency
```

It is recommended to prepare all model configurations before starting the implementation of the model code.

Similarly, you can also refer to the YAML configuration information for corresponding model types of other providers in the `model_providers` directory. The complete YAML rules can be found at: [Schema](schema.md#AIModel).

#### Implementing Model Invocation Code

Next, you need to create a python file named `llm.py` under the `llm` `module` to write the implementation code.

In `llm.py`, create an Anthropic LLM class, which we name `AnthropicLargeLanguageModel` (arbitrarily), inheriting the `__base.large_language_model.LargeLanguageModel` base class, and implement the following methods:

- LLM Invocation

  Implement the core method for LLM invocation, which can support both streaming and synchronous returns.

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

For details on the interface methods, see: [Interfaces](interfaces.md). For specific implementations, refer to: [llm.py](https://github.com/langgenius/dify-runtime/blob/main/lib/model_providers/anthropic/llm/llm.py).

### Testing

To ensure the availability of integrated providers/models, each method written needs corresponding integration test code in the `tests` directory.

Continuing with `Anthropic` as an example:

Before writing test code, you need to first add the necessary credential environment variables for the test provider in `.env.example`, such as: `ANTHROPIC_API_KEY`.

Before execution, copy `.env.example` to `.env` and then execute.

#### Writing Test Code

Create a `module` with the same name as the provider in the `tests` directory: `anthropic`, and continue to create `test_provider.py` and test py files for the corresponding model types within this module, as shown below:

```shell
.
├── __init__.py
├── anthropic
│   ├── __init__.py
│   ├── test_llm.py       # LLM Testing
│   └── test_provider.py  # Provider Testing
```

Write test code for all the various cases implemented above and submit the code after passing the tests.
