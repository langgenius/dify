# 配置规则

- 供应商规则基于 [Provider](#Provider) 实体。

- 模型规则基于 [AIModelEntity](#AIModelEntity) 实体。

> 以下所有实体均基于 `Pydantic BaseModel`，可在 `entities` 模块中找到对应实体。

### Provider

- `provider` (string) 供应商标识，如：`openai`
- `label` (object) 供应商展示名称，i18n，可设置 `en_US` 英文、`zh_Hans` 中文两种语言
  - `zh_Hans ` (string) [optional] 中文标签名，`zh_Hans` 不设置将默认使用 `en_US`。
  - `en_US` (string) 英文标签名
- `description` (object) [optional] 供应商描述，i18n
  - `zh_Hans` (string) [optional] 中文描述
  - `en_US` (string) 英文描述
- `icon_small` (string) [optional] 供应商小 ICON，存储在对应供应商实现目录下的 `_assets` 目录，中英文策略同 `label`
  - `zh_Hans` (string)  [optional] 中文 ICON
  - `en_US` (string) 英文 ICON
- `icon_large` (string) [optional] 供应商大 ICON，存储在对应供应商实现目录下的 _assets 目录，中英文策略同 label
  - `zh_Hans `(string) [optional] 中文 ICON
  - `en_US` (string) 英文 ICON
- `background` (string) [optional] 背景颜色色值，例：#FFFFFF，为空则展示前端默认色值。
- `help` (object) [optional] 帮助信息
  - `title` (object) 帮助标题，i18n
    - `zh_Hans` (string) [optional] 中文标题
    - `en_US` (string) 英文标题
  - `url` (object) 帮助链接，i18n
    - `zh_Hans` (string) [optional] 中文链接
    - `en_US` (string) 英文链接
- `supported_model_types` (array[[ModelType](#ModelType)]) 支持的模型类型
- `configurate_methods` (array[[ConfigurateMethod](#ConfigurateMethod)]) 配置方式
- `provider_credential_schema` ([ProviderCredentialSchema](#ProviderCredentialSchema)) 供应商凭据规格
- `model_credential_schema` ([ModelCredentialSchema](#ModelCredentialSchema)) 模型凭据规格

### AIModelEntity

- `model` (string) 模型标识，如：`gpt-3.5-turbo`
- `label` (object) [optional] 模型展示名称，i18n，可设置 `en_US` 英文、`zh_Hans` 中文两种语言
  - `zh_Hans `(string) [optional] 中文标签名
  - `en_US` (string) 英文标签名
- `model_type` ([ModelType](#ModelType)) 模型类型
- `features` (array[[ModelFeature](#ModelFeature)]) [optional] 支持功能列表
- `model_properties` (object) 模型属性
  - `mode` ([LLMMode](#LLMMode)) 模式 (模型类型 `llm` 可用)
  - `context_size` (int) 上下文大小 (模型类型 `llm` `text-embedding` 可用)
  - `max_chunks` (int) 最大分块数量 (模型类型 `text-embedding ` `moderation` 可用)
  - `file_upload_limit` (int) 文件最大上传限制，单位：MB。（模型类型 `speech2text` 可用）
  - `supported_file_extensions` (string)  支持文件扩展格式，如：mp3,mp4（模型类型 `speech2text` 可用）
  - `default_voice` (string)  缺省音色，必选：alloy,echo,fable,onyx,nova,shimmer（模型类型 `tts` 可用）
  - `voices` (list)  可选音色列表。
    - `mode` (string)  音色模型。（模型类型 `tts` 可用）
    - `name` (string)  音色模型显示名称。（模型类型 `tts` 可用）
    - `language` (string)  音色模型支持语言。（模型类型 `tts` 可用）
  - `word_limit` (int)  单次转换字数限制，默认按段落分段（模型类型 `tts` 可用）
  - `audio_type` (string)  支持音频文件扩展格式，如：mp3,wav（模型类型 `tts` 可用）
  - `max_workers` (int)  支持文字音频转换并发任务数（模型类型 `tts` 可用）
  - `max_characters_per_chunk` (int) 每块最大字符数 (模型类型  `moderation` 可用)
- `parameter_rules` (array[[ParameterRule](#ParameterRule)]) [optional] 模型调用参数规则
- `pricing` ([PriceConfig](#PriceConfig)) [optional] 价格信息
- `deprecated` (bool) 是否废弃。若废弃，模型列表将不再展示，但已经配置的可以继续使用，默认 False。

### ModelType

- `llm` 文本生成模型
- `text-embedding` 文本 Embedding 模型
- `rerank` Rerank 模型
- `speech2text` 语音转文字
- `tts` 文字转语音
- `moderation` 审查

### ConfigurateMethod

- `predefined-model  ` 预定义模型

  表示用户只需要配置统一的供应商凭据即可使用供应商下的预定义模型。
- `customizable-model` 自定义模型

  用户需要新增每个模型的凭据配置。

- `fetch-from-remote` 从远程获取

  与 `predefined-model` 配置方式一致，只需要配置统一的供应商凭据即可，模型通过凭据信息从供应商获取。

### ModelFeature

- `agent-thought` Agent 推理，一般超过 70B 有思维链能力。
- `vision` 视觉，即：图像理解。
- `tool-call` 工具调用
- `multi-tool-call` 多工具调用
- `stream-tool-call` 流式工具调用

### FetchFrom

- `predefined-model` 预定义模型
- `fetch-from-remote` 远程模型

### LLMMode

- `completion` 文本补全
- `chat` 对话

### ParameterRule

- `name` (string) 调用模型实际参数名

- `use_template` (string) [optional] 使用模板
  
  默认预置了 5 种变量内容配置模板：

  - `temperature`
  - `top_p`
  - `frequency_penalty`
  - `presence_penalty`
  - `max_tokens`
  
  可在 use_template 中直接设置模板变量名，将会使用 entities.defaults.PARAMETER_RULE_TEMPLATE 中的默认配置
  不用设置除 `name` 和 `use_template` 之外的所有参数，若设置了额外的配置参数，将覆盖默认配置。
  可参考 `openai/llm/gpt-3.5-turbo.yaml`。

- `label` (object) [optional] 标签，i18n

  - `zh_Hans`(string) [optional] 中文标签名
  - `en_US` (string) 英文标签名

- `type`(string) [optional] 参数类型

  - `int` 整数
  - `float` 浮点数
  - `string` 字符串
  - `boolean` 布尔型

- `help` (string) [optional] 帮助信息

  - `zh_Hans` (string) [optional] 中文帮助信息
  - `en_US` (string) 英文帮助信息

- `required` (bool) 是否必填，默认 False。

- `default`(int/float/string/bool) [optional] 默认值

- `min`(int/float) [optional] 最小值，仅数字类型适用

- `max`(int/float) [optional] 最大值，仅数字类型适用

- `precision`(int) [optional] 精度，保留小数位数，仅数字类型适用

- `options` (array[string]) [optional] 下拉选项值，仅当 `type` 为 `string` 时适用，若不设置或为 null 则不限制选项值

### PriceConfig

- `input` (float) 输入单价，即 Prompt 单价
- `output` (float) 输出单价，即返回内容单价
- `unit` (float) 价格单位，如以 1M tokens 计价，则单价对应的单位 token 数为 `0.000001`
- `currency` (string) 货币单位

### ProviderCredentialSchema

- `credential_form_schemas` (array[[CredentialFormSchema](#CredentialFormSchema)]) 凭据表单规范

### ModelCredentialSchema

- `model` (object) 模型标识，变量名默认 `model`
  - `label` (object) 模型表单项展示名称
    - `en_US` (string) 英文
    - `zh_Hans`(string) [optional] 中文
  - `placeholder` (object) 模型提示内容
    - `en_US`(string) 英文
    - `zh_Hans`(string) [optional] 中文
- `credential_form_schemas` (array[[CredentialFormSchema](#CredentialFormSchema)]) 凭据表单规范

### CredentialFormSchema

- `variable` (string) 表单项变量名
- `label` (object) 表单项标签名
  - `en_US`(string) 英文
  - `zh_Hans` (string) [optional] 中文
- `type` ([FormType](#FormType)) 表单项类型
- `required` (bool) 是否必填
- `default`(string) 默认值
- `options` (array[[FormOption](#FormOption)]) 表单项为 `select` 或 `radio` 专有属性，定义下拉内容
- `placeholder`(object) 表单项为 `text-input `专有属性，表单项 PlaceHolder
  - `en_US`(string) 英文
  - `zh_Hans` (string) [optional] 中文
- `max_length` (int) 表单项为`text-input`专有属性，定义输入最大长度，0 为不限制。
- `show_on` (array[[FormShowOnObject](#FormShowOnObject)]) 当其他表单项值符合条件时显示，为空则始终显示。

### FormType

- `text-input` 文本输入组件
- `secret-input` 密码输入组件
- `select` 单选下拉
- `radio` Radio 组件
- `switch` 开关组件，仅支持 `true` 和 `false`

### FormOption

- `label` (object) 标签
  - `en_US`(string) 英文
  - `zh_Hans`(string) [optional] 中文
- `value` (string) 下拉选项值
- `show_on` (array[[FormShowOnObject](#FormShowOnObject)]) 当其他表单项值符合条件时显示，为空则始终显示。

### FormShowOnObject

- `variable` (string) 其他表单项变量名
- `value` (string) 其他表单项变量值
