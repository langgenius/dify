# Configuration Rules

- Provider rules are based on the [Provider](#Provider) entity.
- Model rules are based on the [AIModelEntity](#AIModelEntity) entity.

> All entities mentioned below are based on `Pydantic BaseModel` and can be found in the `entities` module.

### Provider

- `provider` (string) Provider identifier, e.g., `openai`
- `label` (object) Provider display name, i18n, with `en_US` English and `zh_Hans` Chinese language settings
  - `zh_Hans` (string) [optional] Chinese label name, if `zh_Hans` is not set, `en_US` will be used by default.
  - `en_US` (string) English label name
- `description` (object) Provider description, i18n
  - `zh_Hans` (string) [optional] Chinese description
  - `en_US` (string) English description
- `icon_small` (string) [optional] Small provider ICON, stored in the `_assets` directory under the corresponding provider implementation directory, with the same language strategy as `label`
  - `zh_Hans` (string) Chinese ICON
  - `en_US` (string) English ICON
- `icon_large` (string) [optional] Large provider ICON, stored in the `_assets` directory under the corresponding provider implementation directory, with the same language strategy as `label`
  - `zh_Hans` (string) Chinese ICON
  - `en_US` (string) English ICON
- `background` (string) [optional] Background color value, e.g., #FFFFFF, if empty, the default frontend color value will be displayed.
- `help` (object) [optional] help information
  - `title` (object) help title, i18n
    - `zh_Hans` (string) [optional] Chinese title
    - `en_US` (string) English title
  - `url` (object) help link, i18n
    - `zh_Hans` (string) [optional] Chinese link
    - `en_US` (string) English link
- `supported_model_types` (array[[ModelType](#ModelType)]) Supported model types
- `configurate_methods` (array[[ConfigurateMethod](#ConfigurateMethod)]) Configuration methods
- `provider_credential_schema` ([ProviderCredentialSchema](#ProviderCredentialSchema)) Provider credential specification
- `model_credential_schema` ([ModelCredentialSchema](#ModelCredentialSchema)) Model credential specification

### AIModelEntity

- `model` (string) Model identifier, e.g., `gpt-3.5-turbo`
- `label` (object) [optional] Model display name, i18n, with `en_US` English and `zh_Hans` Chinese language settings
  - `zh_Hans` (string) [optional] Chinese label name
  - `en_US` (string) English label name
- `model_type` ([ModelType](#ModelType)) Model type
- `features` (array[[ModelFeature](#ModelFeature)]) [optional] Supported feature list
- `model_properties` (object) Model properties
  - `mode` ([LLMMode](#LLMMode)) Mode (available for model type `llm`)
  - `context_size` (int) Context size (available for model types `llm`, `text-embedding`)
  - `max_chunks` (int) Maximum number of chunks (available for model types `text-embedding`, `moderation`)
  - `file_upload_limit` (int) Maximum file upload limit, in MB (available for model type `speech2text`)
  - `supported_file_extensions` (string) Supported file extension formats, e.g., mp3, mp4 (available for model type `speech2text`)
  - `default_voice` (string)  default voice, e.g.：alloy,echo,fable,onyx,nova,shimmer（available for model type `tts`）
  - `voices` (list)  List of available voice.（available for model type `tts`）
    - `mode` (string)  voice model.（available for model type `tts`）
    - `name` (string)  voice model display name.（available for model type `tts`）
    - `lanuage` (string)  the voice model supports languages.（available for model type `tts`）
  - `word_limit` (int)  Single conversion word limit, paragraphwise by default（available for model type `tts`）
  - `audio_type` (string)  Support audio file extension format, e.g.：mp3,wav（available for model type `tts`）
  - `max_workers` (int)  Number of concurrent workers supporting text and audio conversion（available for model type`tts`）
  - `max_characters_per_chunk` (int) Maximum characters per chunk (available for model type `moderation`)
- `parameter_rules` (array[[ParameterRule](#ParameterRule)]) [optional] Model invocation parameter rules
- `pricing` ([PriceConfig](#PriceConfig)) [optional] Pricing information
- `deprecated` (bool) Whether deprecated. If deprecated, the model will no longer be displayed in the list, but those already configured can continue to be used. Default False.

### ModelType

- `llm` Text generation model
- `text-embedding` Text Embedding model
- `rerank` Rerank model
- `speech2text` Speech to text
- `tts` Text to speech
- `moderation` Moderation

### ConfigurateMethod

- `predefined-model` Predefined model

  Indicates that users can use the predefined models under the provider by configuring the unified provider credentials.
- `customizable-model` Customizable model

  Users need to add credential configuration for each model.

- `fetch-from-remote` Fetch from remote

  Consistent with the `predefined-model` configuration method, only unified provider credentials need to be configured, and models are obtained from the provider through credential information.

### ModelFeature

- `agent-thought` Agent reasoning, generally over 70B with thought chain capability.
- `vision` Vision, i.e., image understanding.

### FetchFrom

- `predefined-model` Predefined model
- `fetch-from-remote` Remote model

### LLMMode

- `complete` Text completion
- `chat` Dialogue

### ParameterRule

- `name` (string) Actual model invocation parameter name
- `use_template` (string) [optional] Using template

  By default, 5 variable content configuration templates are preset:

  - `temperature`
  - `top_p`
  - `frequency_penalty`
  - `presence_penalty`
  - `max_tokens`
  
  In use_template, you can directly set the template variable name, which will use the default configuration in entities.defaults.PARAMETER_RULE_TEMPLATE
  No need to set any parameters other than `name` and `use_template`. If additional configuration parameters are set, they will override the default configuration.
  Refer to `openai/llm/gpt-3.5-turbo.yaml`.

- `label` (object) [optional] Label, i18n

  - `zh_Hans`(string) [optional] Chinese label name
  - `en_US` (string) English label name

- `type`(string) [optional] Parameter type

  - `int` Integer
  - `float` Float
  - `string` String
  - `boolean` Boolean

- `help` (string) [optional] Help information

  - `zh_Hans` (string) [optional] Chinese help information
  - `en_US` (string) English help information

- `required` (bool) Required, default False.

- `default`(int/float/string/bool) [optional] Default value

- `min`(int/float) [optional] Minimum value, applicable only to numeric types

- `max`(int/float) [optional] Maximum value, applicable only to numeric types

- `precision`(int) [optional] Precision, number of decimal places to keep, applicable only to numeric types

- `options` (array[string]) [optional] Dropdown option values, applicable only when `type` is `string`, if not set or null, option values are not restricted

### PriceConfig

- `input` (float) Input price, i.e., Prompt price
- `output` (float) Output price, i.e., returned content price
- `unit` (float) Pricing unit, e.g., per 100K price is `0.000001`
- `currency` (string) Currency unit

### ProviderCredentialSchema

- `credential_form_schemas` (array[[CredentialFormSchema](#CredentialFormSchema)]) Credential form standard

### ModelCredentialSchema

- `model` (object) Model identifier, variable name defaults to `model`
  - `label` (object) Model form item display name
    - `en_US` (string) English
    - `zh_Hans`(string) [optional] Chinese
  - `placeholder` (object) Model prompt content
    - `en_US`(string) English
    - `zh_Hans`(string) [optional] Chinese
- `credential_form_schemas` (array[[CredentialFormSchema](#CredentialFormSchema)]) Credential form standard

### CredentialFormSchema

- `variable` (string) Form item variable name
- `label` (object) Form item label name
  - `en_US`(string) English
  - `zh_Hans` (string) [optional] Chinese
- `type` ([FormType](#FormType)) Form item type
- `required` (bool) Whether required
- `default`(string) Default value
- `options` (array[[FormOption](#FormOption)]) Specific property of form items of type `select` or `radio`, defining dropdown content
- `placeholder`(object) Specific property of form items of type `text-input`, placeholder content
  - `en_US`(string) English
  - `zh_Hans` (string) [optional] Chinese
- `max_length` (int) Specific property of form items of type `text-input`, defining maximum input length, 0 for no limit.
- `show_on` (array[[FormShowOnObject](#FormShowOnObject)]) Displayed when other form item values meet certain conditions, displayed always if empty.

### FormType

- `text-input` Text input component
- `secret-input` Password input component
- `select` Single-choice dropdown
- `radio` Radio component
- `switch` Switch component, only supports `true` and `false` values

### FormOption

- `label` (object) Label
  - `en_US`(string) English
  - `zh_Hans`(string) [optional] Chinese
- `value` (string) Dropdown option value
- `show_on` (array[[FormShowOnObject](#FormShowOnObject)]) Displayed when other form item values meet certain conditions, displayed always if empty.

### FormShowOnObject

- `variable` (string) Variable name of other form items
- `value` (string) Variable value of other form items
