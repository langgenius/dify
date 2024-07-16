# 快速接入Tool

这里我们以GoogleSearch为例，介绍如何快速接入一个工具。

## 1. 准备工具供应商yaml

### 介绍
这个yaml将包含工具供应商的信息，包括供应商名称、图标、作者等详细信息，以帮助前端灵活展示。

### 示例

我们需要在 `core/tools/provider/builtin`下创建一个`google`模块（文件夹），并创建`google.yaml`，名称必须与模块名称一致。

后续，我们关于这个工具的所有操作都将在这个模块下进行。

```yaml
identity: # 工具供应商的基本信息
  author: Dify # 作者
  name: google # 名称，唯一，不允许和其他供应商重名
  label: # 标签，用于前端展示
    en_US: Google # 英文标签
    zh_Hans: Google # 中文标签
  description: # 描述，用于前端展示
    en_US: Google # 英文描述
    zh_Hans: Google # 中文描述
  icon: icon.svg # 图标，需要放置在当前模块的_assets文件夹下
  tags: # 标签，用于前端展示
    - search

```
 - `identity` 字段是必须的，它包含了工具供应商的基本信息，包括作者、名称、标签、描述、图标等
    - 图标需要放置在当前模块的`_assets`文件夹下，可以参考[这里](../../provider/builtin/google/_assets/icon.svg)。
    - 标签用于前端展示，可以帮助用户快速找到这个工具供应商，下面列出了目前所支持的所有标签
    ```python
    class ToolLabelEnum(Enum):
      SEARCH = 'search'
      IMAGE = 'image'
      VIDEOS = 'videos'
      WEATHER = 'weather'
      FINANCE = 'finance'
      DESIGN = 'design'
      TRAVEL = 'travel'
      SOCIAL = 'social'
      NEWS = 'news'
      MEDICAL = 'medical'
      PRODUCTIVITY = 'productivity'
      EDUCATION = 'education'
      BUSINESS = 'business'
      ENTERTAINMENT = 'entertainment'
      UTILITIES = 'utilities'
      OTHER = 'other'
    ```

## 2. 准备供应商凭据

Google作为一个第三方工具，使用了SerpApi提供的API，而SerpApi需要一个API Key才能使用，那么就意味着这个工具需要一个凭据才可以使用，而像`wikipedia`这样的工具，就不需要填写凭据字段，可以参考[这里](../../provider/builtin/wikipedia/wikipedia.yaml)。

配置好凭据字段后效果如下：
```yaml
identity:
  author: Dify
  name: google
  label:
    en_US: Google
    zh_Hans: Google
  description:
    en_US: Google
    zh_Hans: Google
  icon: icon.svg
credentials_for_provider: # 凭据字段
  serpapi_api_key: # 凭据字段名称
    type: secret-input # 凭据字段类型
    required: true # 是否必填
    label: # 凭据字段标签
      en_US: SerpApi API key # 英文标签
      zh_Hans: SerpApi API key # 中文标签
    placeholder: # 凭据字段占位符
      en_US: Please input your SerpApi API key # 英文占位符
      zh_Hans: 请输入你的 SerpApi API key # 中文占位符
    help: # 凭据字段帮助文本
      en_US: Get your SerpApi API key from SerpApi # 英文帮助文本
      zh_Hans: 从 SerpApi 获取您的 SerpApi API key # 中文帮助文本
    url: https://serpapi.com/manage-api-key # 凭据字段帮助链接

```

- `type`：凭据字段类型，目前支持`secret-input`、`text-input`、`select` 三种类型，分别对应密码输入框、文本输入框、下拉框，如果为`secret-input`，则会在前端隐藏输入内容，并且后端会对输入内容进行加密。

## 3. 准备工具yaml
一个供应商底下可以有多个工具，每个工具都需要一个yaml文件来描述，这个文件包含了工具的基本信息、参数、输出等。

仍然以GoogleSearch为例，我们需要在`google`模块下创建一个`tools`模块，并创建`tools/google_search.yaml`，内容如下。

```yaml
identity: # 工具的基本信息
  name: google_search # 工具名称，唯一，不允许和其他工具重名
  author: Dify # 作者
  label: # 标签，用于前端展示
    en_US: GoogleSearch # 英文标签
    zh_Hans: 谷歌搜索 # 中文标签
description: # 描述，用于前端展示
  human: # 用于前端展示的介绍，支持多语言
    en_US: A tool for performing a Google SERP search and extracting snippets and webpages.Input should be a search query.
    zh_Hans: 一个用于执行 Google SERP 搜索并提取片段和网页的工具。输入应该是一个搜索查询。
  llm: A tool for performing a Google SERP search and extracting snippets and webpages.Input should be a search query. # 传递给LLM的介绍，为了使得LLM更好理解这个工具，我们建议在这里写上关于这个工具尽可能详细的信息，让LLM能够理解并使用这个工具
parameters: # 参数列表
  - name: query # 参数名称
    type: string # 参数类型
    required: true # 是否必填
    label: # 参数标签
      en_US: Query string # 英文标签
      zh_Hans: 查询语句 # 中文标签
    human_description: # 用于前端展示的介绍，支持多语言
      en_US: used for searching
      zh_Hans: 用于搜索网页内容
    llm_description: key words for searching # 传递给LLM的介绍，同上，为了使得LLM更好理解这个参数，我们建议在这里写上关于这个参数尽可能详细的信息，让LLM能够理解这个参数
    form: llm # 表单类型，llm表示这个参数需要由Agent自行推理出来，前端将不会展示这个参数
  - name: result_type
    type: select # 参数类型
    required: true
    options: # 下拉框选项
      - value: text
        label:
          en_US: text
          zh_Hans: 文本
      - value: link
        label:
          en_US: link
          zh_Hans: 链接
    default: link
    label:
      en_US: Result type
      zh_Hans: 结果类型
    human_description:
      en_US: used for selecting the result type, text or link
      zh_Hans: 用于选择结果类型，使用文本还是链接进行展示
    form: form # 表单类型，form表示这个参数需要由用户在对话开始前在前端填写

```

- `identity` 字段是必须的，它包含了工具的基本信息，包括名称、作者、标签、描述等
- `parameters` 参数列表
    - `name` （必填）参数名称，唯一，不允许和其他参数重名
    - `type` （必填）参数类型，目前支持`string`、`number`、`boolean`、`select`、`secret-input` 五种类型，分别对应字符串、数字、布尔值、下拉框、加密输入框，对于敏感信息，我们建议使用`secret-input`类型
    - `label`（必填）参数标签，用于前端展示
    - `form` （必填）表单类型，目前支持`llm`、`form`两种类型
        - 在Agent应用中，`llm`表示该参数LLM自行推理，`form`表示要使用该工具可提前设定的参数
        - 在workflow应用中，`llm`和`form`均需要前端填写，但`llm`的参数会做为工具节点的输入变量
    - `required` 是否必填
        - 在`llm`模式下，如果参数为必填，则会要求Agent必须要推理出这个参数
        - 在`form`模式下，如果参数为必填，则会要求用户在对话开始前在前端填写这个参数
    - `options` 参数选项
        - 在`llm`模式下，Dify会将所有选项传递给LLM，LLM可以根据这些选项进行推理
        - 在`form`模式下，`type`为`select`时，前端会展示这些选项
    - `default` 默认值
    - `min` 最小值，当参数类型为`number`时可以设定
    - `max` 最大值，当参数类型为`number`时可以设定
    - `human_description` 用于前端展示的介绍，支持多语言
    - `placeholder` 字段输入框的提示文字，在表单类型为`form`，参数类型为`string`、`number`、`secret-input`时，可以设定，支持多语言
    - `llm_description` 传递给LLM的介绍，为了使得LLM更好理解这个参数，我们建议在这里写上关于这个参数尽可能详细的信息，让LLM能够理解这个参数


## 4. 准备工具代码
当完成工具的配置以后，我们就可以开始编写工具代码了，主要用于实现工具的逻辑。

在`google/tools`模块下创建`google_search.py`，内容如下。

```python
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage

from typing import Any, Dict, List, Union

class GoogleSearchTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
               tool_parameters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        query = tool_parameters['query']
        result_type = tool_parameters['result_type']
        api_key = self.runtime.credentials['serpapi_api_key']
        result = SerpAPI(api_key).run(query, result_type=result_type)

        if result_type == 'text':
            return self.create_text_message(text=result)
        return self.create_link_message(link=result)
```

### 参数
工具的整体逻辑都在`_invoke`方法中，这个方法接收两个参数：`user_id`和`tool_parameters`，分别表示用户ID和工具参数

### 返回数据
在工具返回时，你可以选择返回一条消息或者多个消息，这里我们返回一条消息，使用`create_text_message`和`create_link_message`可以创建一条文本消息或者一条链接消息。如需返回多条消息，可以使用列表构建，例如`[self.create_text_message('msg1'), self.create_text_message('msg2')]`

## 5. 准备供应商代码
最后，我们需要在供应商模块下创建一个供应商类，用于实现供应商的凭据验证逻辑，如果凭据验证失败，将会抛出`ToolProviderCredentialValidationError`异常。

在`google`模块下创建`google.py`，内容如下。

```python
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError

from core.tools.provider.builtin.google.tools.google_search import GoogleSearchTool

from typing import Any, Dict

class GoogleProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        try:
            # 1. 此处需要使用GoogleSearchTool()实例化一个GoogleSearchTool，它会自动加载GoogleSearchTool的yaml配置，但是此时它内部没有凭据信息
            # 2. 随后需要使用fork_tool_runtime方法，将当前的凭据信息传递给GoogleSearchTool
            # 3. 最后invoke即可，参数需要根据GoogleSearchTool的yaml中配置的参数规则进行传递
            GoogleSearchTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "query": "test",
                    "result_type": "link"
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
```

## 完成
当上述步骤完成以后，我们就可以在前端看到这个工具了，并且可以在Agent中使用这个工具。

当然，因为google_search需要一个凭据，在使用之前，还需要在前端配置它的凭据。

![Alt text](images/index/image-2.png)
