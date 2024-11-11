# 高度なツール統合

このガイドを始める前に、Difyのツール統合プロセスの基本を理解していることを確認してください。簡単な概要については[クイック統合](./tool_scale_out.md)をご覧ください。

## ツールインターフェース

より複雑なツールを迅速に構築するのを支援するため、`Tool`クラスに一連のヘルパーメソッドを定義しています。

### メッセージの返却

Difyは`テキスト`、`リンク`、`画像`、`ファイルBLOB`、`JSON`などの様々なメッセージタイプをサポートしています。以下のインターフェースを通じて、異なるタイプのメッセージをLLMとユーザーに返すことができます。

注意：以下のインターフェースの一部のパラメータについては、後のセクションで説明します。

#### 画像URL
画像のURLを渡すだけで、Difyが自動的に画像をダウンロードしてユーザーに返します。

```python
    def create_image_message(self, image: str, save_as: str = '') -> ToolInvokeMessage:
    """
        create an image message

        :param image: the url of the image
        :param save_as: save as
        :return: the image message
    """
```

#### リンク
リンクを返す必要がある場合は、以下のインターフェースを使用できます。

```python
    def create_link_message(self, link: str, save_as: str = '') -> ToolInvokeMessage:
    """
        create a link message

        :param link: the url of the link
        :param save_as: save as
        :return: the link message
    """
```

#### テキスト
テキストメッセージを返す必要がある場合は、以下のインターフェースを使用できます。

```python
    def create_text_message(self, text: str, save_as: str = '') -> ToolInvokeMessage:
    """
        create a text message

        :param text: the text of the message
        :param save_as: save as
        :return: the text message
    """
```

#### ファイルBLOB
画像、音声、動画、PPT、Word、Excelなどのファイルの生データを返す必要がある場合は、以下のインターフェースを使用できます。

- `blob` ファイルの生データ（bytes型）
- `meta` ファイルのメタデータ。ファイルの種類が分かっている場合は、`mime_type`を渡すことをお勧めします。そうでない場合、Difyはデフォルトタイプとして`octet/stream`を使用します。

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
フォーマットされたJSONを返す必要がある場合は、以下のインターフェースを使用できます。これは通常、ワークフロー内のノード間のデータ伝送に使用されますが、エージェントモードでは、ほとんどの大規模言語モデルもJSONを読み取り、理解することができます。

- `object` Pythonの辞書オブジェクトで、自動的にJSONにシリアライズされます。

```python
    def create_json_message(self, object: dict) -> ToolInvokeMessage:
    """
        create a json message
    """
```

### ショートカットツール

大規模モデルアプリケーションでは、以下の2つの一般的なニーズがあります：
- まず長いテキストを事前に要約し、その要約内容をLLMに渡すことで、元のテキストが長すぎてLLMが処理できない問題を防ぐ
- ツールが取得したコンテンツがリンクである場合、Webページ情報をクロールしてからLLMに返す必要がある

開発者がこれら2つのニーズを迅速に実装できるよう、以下の2つのショートカットツールを提供しています。

#### テキスト要約ツール

このツールはuser_idと要約するテキストを入力として受け取り、要約されたテキストを返します。Difyは現在のワークスペースのデフォルトモデルを使用して長文を要約します。

```python
    def summary(self, user_id: str, content: str) -> str:
    """
        summary the content

        :param user_id: the user id
        :param content: the content
        :return: the summary
    """
```

#### Webページクローリングツール

このツールはクロールするWebページのリンクとユーザーエージェント（空でも可）を入力として受け取り、そのWebページの情報を含む文字列を返します。`user_agent`はオプションのパラメータで、ツールを識別するために使用できます。渡さない場合、Difyはデフォルトの`user_agent`を使用します。

```python
    def get_url(self, url: str, user_agent: str = None) -> str:
    """
        get url from the crawled result
    """ 
```

### 変数プール

`Tool`内に変数プールを導入し、ツールの実行中に生成された変数やファイルなどを保存します。これらの変数は、ツールの実行中に他のツールが使用することができます。

次に、`DallE3`と`Vectorizer.AI`を例に、変数プールの使用方法を紹介します。

- `DallE3`は画像生成ツールで、テキストに基づいて画像を生成できます。ここでは、`DallE3`にカフェのロゴを生成させます。
- `Vectorizer.AI`はベクター画像変換ツールで、画像をベクター画像に変換できるため、画像を無限に拡大しても品質が損なわれません。ここでは、`DallE3`が生成したPNGアイコンをベクター画像に変換し、デザイナーが実際に使用できるようにします。

#### DallE3
まず、DallE3を使用します。画像を作成した後、その画像を変数プールに保存します。コードは以下の通りです：

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
            # Save all images to the variable pool through the save_as parameter. The variable name is self.VARIABLE_KEY.IMAGE.value. If new images are generated later, they will overwrite the previous images.
            result.append(self.create_blob_message(blob=b64decode(image.b64_json),
                                                   meta={ 'mime_type': 'image/png' },
                                                   save_as=self.VARIABLE_KEY.IMAGE.value))

        return result
```

ここでは画像の変数名として`self.VARIABLE_KEY.IMAGE.value`を使用していることに注意してください。開発者のツールが互いに連携できるよう、この`KEY`を定義しました。自由に使用することも、この`KEY`を使用しないこともできます。カスタムのKEYを渡すこともできます。

#### Vectorizer.AI
次に、Vectorizer.AIを使用して、DallE3が生成したPNGアイコンをベクター画像に変換します。ここで定義した関数を見てみましょう。コードは以下の通りです：

```python
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.tools.errors import ToolProviderCredentialValidationError

from typing import Any, Dict, List, Union
from httpx import post
from base64 import b64decode

class VectorizerTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: Dict[str, Any])
        -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
        Tool invocation, the image variable name needs to be passed in from here, so that we can get the image from the variable pool
        """


    def get_runtime_parameters(self) -> List[ToolParameter]:
        """
        Override the tool parameter list, we can dynamically generate the parameter list based on the actual situation in the current variable pool, so that the LLM can generate the form based on the parameter list
        """


    def is_tool_available(self) -> bool:
        """
        Whether the current tool is available, if there is no image in the current variable pool, then we don't need to display this tool, just return False here
        """     
```

次に、これら3つの関数を実装します：

```python
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.tools.errors import ToolProviderCredentialValidationError

from typing import Any, Dict, List, Union
from httpx import post
from base64 import b64decode

class VectorizerTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: Dict[str, Any])
        -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        api_key_name = self.runtime.credentials.get('api_key_name', None)
        api_key_value = self.runtime.credentials.get('api_key_value', None)

        if not api_key_name or not api_key_value:
            raise ToolProviderCredentialValidationError('Please input api key name and value')

        # Get image_id, the definition of image_id can be found in get_runtime_parameters
        image_id = tool_parameters.get('image_id', '')
        if not image_id:
            return self.create_text_message('Please input image id')

        # Get the image generated by DallE from the variable pool
        image_binary = self.get_variable_file(self.VARIABLE_KEY.IMAGE)
        if not image_binary:
            return self.create_text_message('Image not found, please request user to generate image firstly.')

        # Generate vector image
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
        # Here, we override the tool parameter list, define the image_id, and set its option list to all images in the current variable pool. The configuration here is consistent with the configuration in yaml.
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
        # Only when there are images in the variable pool, the LLM needs to use this tool
        return len(self.list_default_image_variables()) > 0
```

ここで注目すべきは、実際には`image_id`を使用していないことです。このツールを呼び出す際には、デフォルトの変数プールに必ず画像があると仮定し、直接`image_binary = self.get_variable_file(self.VARIABLE_KEY.IMAGE)`を使用して画像を取得しています。モデルの能力が弱い場合、開発者にもこの方法を推奨します。これにより、エラー許容度を効果的に向上させ、モデルが誤ったパラメータを渡すのを防ぐことができます。