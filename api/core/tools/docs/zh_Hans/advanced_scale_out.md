# 高级接入Tool

在开始高级接入之前，请确保你已经阅读过[快速接入](./tool_scale_out.md)，并对Dify的工具接入流程有了基本的了解。

## 工具接口

我们在`Tool`类中定义了一系列快捷方法，用于帮助开发者快速构较为复杂的工具

### 消息返回

Dify支持`文本` `链接` `图片` `文件BLOB` `JSON` 等多种消息类型，你可以通过以下几个接口返回不同类型的消息给LLM和用户。

注意，在下面的接口中的部分参数将在后面的章节中介绍。

#### 图片URL
只需要传递图片的URL即可，Dify会自动下载图片并返回给用户。

```python
    def create_image_message(self, image: str, save_as: str = '') -> ToolInvokeMessage:
        """
            create an image message

            :param image: the url of the image
            :param save_as: save as
            :return: the image message
        """
```

#### 链接
如果你需要返回一个链接，可以使用以下接口。

```python
    def create_link_message(self, link: str, save_as: str = '') -> ToolInvokeMessage:
        """
            create a link message

            :param link: the url of the link
            :param save_as: save as
            :return: the link message
        """
```

#### 文本
如果你需要返回一个文本消息，可以使用以下接口。

```python
    def create_text_message(self, text: str, save_as: str = '') -> ToolInvokeMessage:
        """
            create a text message

            :param text: the text of the message
            :param save_as: save as
            :return: the text message
        """
```

#### 文件BLOB
如果你需要返回文件的原始数据，如图片、音频、视频、PPT、Word、Excel等，可以使用以下接口。

- `blob` 文件的原始数据，bytes类型
- `meta` 文件的元数据，如果你知道该文件的类型，最好传递一个`mime_type`，否则Dify将使用`octet/stream`作为默认类型

```python
    def create_blob_message(self, blob: bytes, meta: dict = None, save_as: str = '') -> ToolInvokeMessage:
        """
            create a blob message

            :param blob: the blob
            :param meta: meta
            :param save_as: save as
            :return: the blob message
        """
```

#### JSON
如果你需要返回一个格式化的JSON，可以使用以下接口。这通常用于workflow中的节点间的数据传递，当然agent模式中，大部分大模型也都能够阅读和理解JSON。

- `object` 一个Python的字典对象，会被自动序列化为JSON

```python
    def create_json_message(self, object: dict) -> ToolInvokeMessage:
        """
            create a json message
        """
```

### 快捷工具

在大模型应用中，我们有两种常见的需求：
- 先将很长的文本进行提前总结，然后再将总结内容传递给LLM，以防止原文本过长导致LLM无法处理
- 工具获取到的内容是一个链接，需要爬取网页信息后再返回给LLM

为了帮助开发者快速实现这两种需求，我们提供了以下两个快捷工具。

#### 文本总结工具

该工具需要传入user_id和需要进行总结的文本，返回一个总结后的文本，Dify会使用当前工作空间的默认模型对长文本进行总结。

```python
    def summary(self, user_id: str, content: str) -> str:
        """
            summary the content

            :param user_id: the user id
            :param content: the content
            :return: the summary
        """
```

#### 网页爬取工具

该工具需要传入需要爬取的网页链接和一个user_agent（可为空），返回一个包含该网页信息的字符串，其中`user_agent`是可选参数，可以用来识别工具，如果不传递，Dify将使用默认的`user_agent`。

```python
    def get_url(self, url: str, user_agent: str = None) -> str:
        """
            get url from the crawled result
        """ 
```

### 变量池

我们在`Tool`中引入了一个变量池，用于存储工具运行过程中产生的变量、文件等，这些变量可以在工具运行过程中被其他工具使用。

下面，我们以`DallE3`和`Vectorizer.AI`为例，介绍如何使用变量池。

- `DallE3`是一个图片生成工具，它可以根据文本生成图片，在这里，我们将让`DallE3`生成一个咖啡厅的Logo
- `Vectorizer.AI`是一个矢量图转换工具，它可以将图片转换为矢量图，使得图片可以无限放大而不失真，在这里，我们将`DallE3`生成的PNG图标转换为矢量图，从而可以真正被设计师使用。

#### DallE3
首先我们使用DallE3，在创建完图片以后，我们将图片保存到变量池中，代码如下

```python
from typing import Any, Dict, List, Union
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

from base64 import b64decode

from openai import OpenAI

class DallE3Tool(BuiltinTool):
    def _invoke(self, 
                user_id: str, 
               tool_parameters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        client = OpenAI(
            api_key=self.runtime.credentials['openai_api_key'],
        )

        # prompt
        prompt = tool_parameters.get('prompt', '')
        if not prompt:
            return self.create_text_message('Please input prompt')

        # call openapi dalle3
        response = client.images.generate(
            prompt=prompt, model='dall-e-3',
            size='1024x1024', n=1, style='vivid', quality='standard',
            response_format='b64_json'
        )

        result = []
        for image in response.data:
            # 将所有图片通过save_as参数保存到变量池中，变量名为self.VARIABLE_KEY.IMAGE.value，如果如果后续有新的图片生成，那么将会覆盖之前的图片
            result.append(self.create_blob_message(blob=b64decode(image.b64_json), 
                                                   meta={ 'mime_type': 'image/png' },
                                                    save_as=self.VARIABLE_KEY.IMAGE.value))

        return result
```

我们可以注意到这里我们使用了`self.VARIABLE_KEY.IMAGE.value`作为图片的变量名，为了便于开发者们的工具能够互相配合，我们定义了这个`KEY`，大家可以自由使用，也可以不使用这个`KEY`，传递一个自定义的KEY也是可以的。

#### Vectorizer.AI
接下来我们使用Vectorizer.AI，将DallE3生成的PNG图标转换为矢量图，我们先来过一遍我们在这里定义的函数，代码如下

```python
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.tools.errors import ToolProviderCredentialValidationError

from typing import Any, Dict, List, Union
from httpx import post
from base64 import b64decode

class VectorizerTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: Dict[str, Any]) \
        -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
        工具调用，图片变量名需要从这里传递进来，从而我们就可以从变量池中获取到图片
        """
        
    
    def get_runtime_parameters(self) -> List[ToolParameter]:
        """
        重写工具参数列表，我们可以根据当前变量池里的实际情况来动态生成参数列表，从而LLM可以根据参数列表来生成表单
        """
        
    
    def is_tool_available(self) -> bool:
        """
        当前工具是否可用，如果当前变量池中没有图片，那么我们就不需要展示这个工具，这里返回False即可
        """     
```

接下来我们来实现这三个函数

```python
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.tools.errors import ToolProviderCredentialValidationError

from typing import Any, Dict, List, Union
from httpx import post
from base64 import b64decode

class VectorizerTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: Dict[str, Any]) \
        -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        api_key_name = self.runtime.credentials.get('api_key_name', None)
        api_key_value = self.runtime.credentials.get('api_key_value', None)

        if not api_key_name or not api_key_value:
            raise ToolProviderCredentialValidationError('Please input api key name and value')

        # 获取image_id，image_id的定义可以在get_runtime_parameters中找到
        image_id = tool_parameters.get('image_id', '')
        if not image_id:
            return self.create_text_message('Please input image id')

        # 从变量池中获取到之前DallE生成的图片
        image_binary = self.get_variable_file(self.VARIABLE_KEY.IMAGE)
        if not image_binary:
            return self.create_text_message('Image not found, please request user to generate image firstly.')

        # 生成矢量图
        response = post(
            'https://vectorizer.ai/api/v1/vectorize',
            files={ 'image': image_binary },
            data={ 'mode': 'test' },
            auth=(api_key_name, api_key_value), 
            timeout=30
        )

        if response.status_code != 200:
            raise Exception(response.text)
        
        return [
            self.create_text_message('the vectorized svg is saved as an image.'),
            self.create_blob_message(blob=response.content,
                                    meta={'mime_type': 'image/svg+xml'})
        ]
    
    def get_runtime_parameters(self) -> List[ToolParameter]:
        """
        override the runtime parameters
        """
        # 这里，我们重写了工具参数列表，定义了image_id，并设置了它的选项列表为当前变量池中的所有图片，这里的配置与yaml中的配置是一致的
        return [
            ToolParameter.get_simple_instance(
                name='image_id',
                llm_description=f'the image id that you want to vectorize, \
                    and the image id should be specified in \
                        {[i.name for i in self.list_default_image_variables()]}',
                type=ToolParameter.ToolParameterType.SELECT,
                required=True,
                options=[i.name for i in self.list_default_image_variables()]
            )
        ]
    
    def is_tool_available(self) -> bool:
        # 只有当变量池中有图片时，LLM才需要使用这个工具
        return len(self.list_default_image_variables()) > 0
```

可以注意到的是，我们这里其实并没有使用到`image_id`，我们已经假设了调用这个工具的时候一定有一张图片在默认的变量池中，所以直接使用了`image_binary = self.get_variable_file(self.VARIABLE_KEY.IMAGE)`来获取图片，在模型能力较弱的情况下，我们建议开发者们也这样做，可以有效提升容错率，避免模型传递错误的参数。