import { CodeGroup } from '../code.tsx'
import { Row, Col, Properties, Property, Heading, SubProperty, Paragraph } from '../md.tsx'

# 高度なチャットアプリ API

チャットアプリケーションはセッションの持続性をサポートしており、以前のチャット履歴を応答のコンテキストとして使用できます。これは、チャットボットやカスタマーサービス AI などに適用できます。

<div>
  ### ベース URL
  <CodeGroup title="コード" targetCode={props.appDetail.api_base_url} />

  ### 認証

  サービス API は `API-Key` 認証を使用します。
  <i>**API キーはサーバー側に保存し、クライアント側で共有または保存しないことを強くお勧めします。API キーの漏洩は深刻な結果を招く可能性があります。**</i>

  すべての API リクエストには、以下のように `Authorization`HTTP ヘッダーに API キーを含めてください：

  <CodeGroup title="コード" targetCode='Authorization: Bearer {API_KEY}' />
</div>

---

<Heading
  url='/chat-messages'
  method='POST'
  title='チャットメッセージを送信'
  name='#Send-Chat-Message'
/>
<Row>
  <Col>
    チャットアプリケーションにリクエストを送信します。

    ### リクエストボディ

    <Properties>
      <Property name='query' type='string' key='query'>
        ユーザー入力/質問内容
      </Property>
      <Property name='inputs' type='object' key='inputs'>
          アプリによって定義されたさまざまな変数値の入力を許可します。
          `inputs`パラメータには複数のキー/値ペアが含まれ、各キーは特定の変数に対応し、各値はその変数の特定の値です。
          変数がファイルタイプの場合、以下の`files`で説明されているキーを持つオブジェクトを指定します。
          デフォルト`{}`
      </Property>
      <Property name='response_mode' type='string' key='response_mode'>
        応答の返却モードを指定します。サポートされているモード：
        - `streaming` ストリーミングモード（推奨）、SSE（[サーバー送信イベント](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)）を通じてタイプライターのような出力を実装します。
        - `blocking` ブロッキングモード、実行完了後に結果を返します。（プロセスが長い場合、リクエストが中断される可能性があります）
        Cloudflareの制限により、リクエストは100秒後に返答なしで中断されます。
      </Property>
      <Property name='user' type='string' key='user'>
          ユーザー識別子、エンドユーザーの身元を定義するために使用され、統計のために使用されます。
          アプリケーション内で開発者によって一意に定義されるべきです。サービス API は WebApp によって作成された会話を共有しません。
      </Property>
      <Property name='conversation_id' type='string' key='conversation_id'>
      会話ID、以前のチャット記録に基づいて会話を続けるには、以前のメッセージのconversation_idを渡す必要があります。
      </Property>
      <Property name='files' type='array[object]' key='files'>
          ファイルリスト、モデルが Vision/Video 機能をサポートしている場合に限り、ファイルをテキスト理解および質問応答に組み合わせて入力するのに適しています。
          - `type` (string) サポートされるタイプ：
            - `document` サポートされるタイプには以下が含まれます：'TXT', 'MD', 'MARKDOWN', 'MDX', 'PDF', 'HTML', 'XLSX', 'XLS', 'VTT', 'PROPERTIES', 'DOC', 'DOCX', 'CSV', 'EML', 'MSG', 'PPTX', 'PPT', 'XML', 'EPUB'
            - `image` サポートされるタイプには以下が含まれます：'JPG', 'JPEG', 'PNG', 'GIF', 'WEBP', 'SVG'
            - `audio` サポートされるタイプには以下が含まれます：'MP3', 'M4A', 'WAV', 'WEBM', 'MPGA'
            - `video` サポートされるタイプには以下が含まれます：'MP4', 'MOV', 'MPEG', 'WEBM'
            - `custom` サポートされるタイプには以下が含まれます：その他のファイルタイプ
          - `transfer_method` (string) 転送方法:
            - `remote_url`: ファイルのURL。
            - `local_file`: ファイルをアップロード。
          - `url` ファイルのURL。（転送方法が `remote_url` の場合のみ）。
          - `upload_file_id` アップロードされたファイルID。（転送方法が `local_file` の場合のみ）。
      </Property>
      <Property name='auto_generate_name' type='bool' key='auto_generate_name'>
      タイトルを自動生成、デフォルトは`true`。
      `false`に設定すると、会話のリネームAPIを呼び出し、`auto_generate`を`true`に設定することで非同期タイトル生成を実現できます。
      </Property>
      <Property name='workflow_id' type='string' key='workflow_id'>
      （オプション）ワークフローID、特定のバージョンを指定するために使用、提供されない場合はデフォルトの公開バージョンを使用。
      </Property>
      <Property name='trace_id' type='string' key='trace_id'>
        （オプション）トレースID。既存の業務システムのトレースコンポーネントと連携し、エンドツーエンドの分散トレーシングを実現するために使用します。指定がない場合、システムが自動的に trace_id を生成します。以下の3つの方法で渡すことができ、優先順位は次のとおりです：<br/>
        - Header：HTTPヘッダー <code>X-Trace-Id</code> で渡す（最優先）。<br/>
        - クエリパラメータ：URLクエリパラメータ <code>trace_id</code> で渡す。<br/>
        - リクエストボディ：リクエストボディの <code>trace_id</code> フィールドで渡す（本フィールド）。<br/>
      </Property>
    </Properties>

    ### 応答
    response_modeがブロッキングの場合、CompletionResponseオブジェクトを返します。
    response_modeがストリーミングの場合、ChunkCompletionResponseストリームを返します。

    ### ChatCompletionResponse
    完全なアプリ結果を返します。`Content-Type`は`application/json`です。
    - `event` (string) イベントタイプ、固定で `message`
    - `task_id` (string) タスクID、リクエスト追跡と以下のStop Generate APIに使用
    - `id` (string) ユニークID
    - `message_id` (string) 一意のメッセージID
    - `conversation_id` (string) 会話ID
    - `mode` (string) アプリモード、`chat`として固定
    - `answer` (string) 完全な応答内容
    - `metadata` (object) メタデータ
      - `usage` (Usage) モデル使用情報
      - `retriever_resources` (array[RetrieverResource]) 引用と帰属リスト
    - `created_at` (int) メッセージ作成タイムスタンプ、例：1705395332

    ### ChunkChatCompletionResponse
    アプリによって出力されたストリームチャンクを返します。`Content-Type`は`text/event-stream`です。
    各ストリーミングチャンクは`data:`で始まり、2つの改行文字`\n\n`で区切られます。以下のように表示されます：
    <CodeGroup>
    ```streaming {{ title: '応答' }}
    data: {"event": "message", "task_id": "900bbd43-dc0b-4383-a372-aa6e6c414227", "id": "663c5084-a254-4040-8ad3-51f2a3c1a77c", "answer": "Hi", "created_at": 1705398420}\n\n
    ```
    </CodeGroup>
    ストリーミングチャンクの構造は`event`に応じて異なります：
    - `event: message` LLMがテキストチャンクイベントを返します。つまり、完全なテキストがチャンク形式で出力されます。
      - `task_id` (string) タスクID、リクエスト追跡と以下のStop Generate APIに使用
      - `message_id` (string) 一意のメッセージID
      - `conversation_id` (string) 会話ID
      - `answer` (string) LLMが返したテキストチャンク内容
      - `created_at` (int) 作成タイムスタンプ、例：1705395332
    - `event: message_file` メッセージファイルイベント、ツールによって新しいファイルが作成されました
      - `id` (string) ファイル一意ID
      - `type` (string) ファイルタイプ、現在は"image"のみ許可
      - `belongs_to` (string) 所属、ここでは'assistant'のみ
      - `url` (string) ファイルのリモートURL
      - `conversation_id`  (string) 会話ID
    - `event: message_end` メッセージ終了イベント、このイベントを受信するとストリーミングが終了したことを意味します。
      - `task_id` (string) タスクID、リクエスト追跡と以下のStop Generate APIに使用
      - `message_id` (string) 一意のメッセージID
      - `conversation_id` (string) 会話ID
      - `metadata` (object) メタデータ
        - `usage` (Usage) モデル使用情報
        - `retriever_resources` (array[RetrieverResource]) 引用と帰属リスト
    - `event: tts_message` TTSオーディオストリームイベント、つまり音声合成出力。内容はMp3形式のオーディオブロックで、base64文字列としてエンコードされています。再生時には、base64をデコードしてプレーヤーに入力するだけです。（このメッセージは自動再生が有効な場合にのみ利用可能）
      - `task_id` (string) タスクID、リクエスト追跡と以下のストップ応答インターフェースに使用
      - `message_id` (string) 一意のメッセージID
      - `audio` (string) 音声合成後のオーディオ、base64テキストコンテンツとしてエンコードされており、再生時にはbase64をデコードしてプレーヤーに入力するだけです
      - `created_at` (int) 作成タイムスタンプ、例：1705395332
    - `event: tts_message_end` TTSオーディオストリーム終了イベント、このイベントを受信するとオーディオストリームが終了したことを示します。
      - `task_id` (string) タスクID、リクエスト追跡と以下のストップ応答インターフェースに使用
      - `message_id` (string) 一意のメッセージID
      - `audio` (string) 終了イベントにはオーディオがないため、これは空の文字列です
      - `created_at` (int) 作成タイムスタンプ、例：1705395332
    - `event: message_replace` メッセージ内容置換イベント。
      出力内容のモデレーションが有効な場合、内容がフラグ付けされると、このイベントを通じてメッセージ内容がプリセットの返信に置き換えられます。
      - `task_id` (string) タスクID、リクエスト追跡と以下のStop Generate APIに使用
      - `message_id` (string) 一意のメッセージID
      - `conversation_id` (string) 会話ID
      - `answer` (string) 置換内容（すべてのLLM返信テキストを直接置き換えます）
      - `created_at` (int) 作成タイムスタンプ、例：1705395332
    - `event: workflow_started` ワークフローが実行を開始
      - `task_id` (string) タスクID、リクエスト追跡と以下のStop Generate APIに使用
      - `workflow_run_id` (string) ワークフロー実行の一意ID
      - `event` (string) `workflow_started`に固定
      - `data` (object) 詳細
        - `id` (string) ワークフロー実行の一意ID
        - `workflow_id` (string) 関連ワークフローのID
        - `created_at` (timestamp) 作成タイムスタンプ、例：1705395332
    - `event: node_started` ノード実行が開始
      - `task_id` (string) タスクID、リクエスト追跡と以下のStop Generate APIに使用
      - `workflow_run_id` (string) ワークフロー実行の一意ID
      - `event` (string) `node_started`に固定
      - `data` (object) 詳細
        - `id` (string) ワークフロー実行の一意ID
        - `node_id` (string) ノードのID
        - `node_type` (string) ノードのタイプ
        - `title` (string) ノードの名前
        - `index` (int) 実行シーケンス番号、トレースノードシーケンスを表示するために使用
        - `predecessor_node_id` (string) オプションのプレフィックスノードID、キャンバス表示実行パスに使用
        - `inputs` (object) ノードで使用されるすべての前のノード変数の内容
        - `created_at` (timestamp) 開始のタイムスタンプ、例：1705395332
    - `event: node_finished` ノード実行が終了、成功または失敗は同じイベント内で異なる状態で示されます
      - `task_id` (string) タスクID、リクエスト追跡と以下のStop Generate APIに使用
      - `workflow_run_id` (string) ワークフロー実行の一意ID
      - `event` (string) `node_finished`に固定
      - `data` (object) 詳細
        - `id` (string) ワークフロー実行の一意ID
        - `node_id` (string) ノードのID
        - `node_type` (string) ノードのタイプ
        - `title` (string) ノードの名前
        - `index` (int) 実行シーケンス番号、トレースノードシーケンスを表示するために使用
        - `predecessor_node_id` (string) オプションのプレフィックスノードID、キャンバス表示実行パスに使用
        - `inputs` (object) ノードで使用されるすべての前のノード変数の内容
        - `process_data` (json) オプションのノードプロセスデータ
        - `outputs` (json) オプションの出力内容
        - `status` (string) 実行の状態、`running` / `succeeded` / `failed` / `stopped`
        - `error` (string) オプションのエラー理由
        - `elapsed_time` (float) オプションの使用される合計秒数
        - `execution_metadata` (json) メタデータ
          - `total_tokens` (int) オプションの使用されるトークン数
          - `total_price` (decimal) オプションの合計コスト
          - `currency` (string) オプション、例：`USD` / `RMB`
        - `created_at` (timestamp) 開始のタイムスタンプ、例：1705395332
    - `event: workflow_finished` ワークフロー実行が終了、成功または失敗は同じイベント内で異なる状態で示されます
      - `task_id` (string) タスクID、リクエスト追跡と以下のStop Generate APIに使用
      - `workflow_run_id` (string) ワークフロー実行の一意ID
      - `event` (string) `workflow_finished`に固定
      - `data` (object) 詳細
        - `id` (string) ワークフロー実行のID
        - `workflow_id` (string) 関連ワークフローのID
        - `status` (string) 実行の状態、`running` / `succeeded` / `failed` / `stopped`
        - `outputs` (json) オプションの出力内容
        - `error` (string) オプションのエラー理由
        - `elapsed_time` (float) オプションの使用される合計秒数
        - `total_tokens` (int) オプションの使用されるトークン数
        - `total_steps` (int) デフォルト0
        - `created_at` (timestamp) 開始時間
        - `finished_at` (timestamp) 終了時間
    - `event: error`
      ストリーミングプロセス中に発生する例外はストリームイベントの形式で出力され、エラーイベントを受信するとストリームが終了します。
      - `task_id` (string) タスクID、リクエスト追跡と以下のStop Generate APIに使用
      - `message_id` (string) 一意のメッセージID
      - `status` (int) HTTPステータスコード
      - `code` (string) エラーコード
      - `message` (string) エラーメッセージ
    - `event: ping` 接続を維持するために10秒ごとにpingイベントが発生します。

    ### エラー
    - 404, 会話が存在しません
    - 400, `invalid_param`, 異常なパラメータ入力
    - 400, `app_unavailable`, アプリ構成が利用できません
    - 400, `provider_not_initialize`, 利用可能なモデル資格情報構成がありません
    - 400, `provider_quota_exceeded`, モデル呼び出しクォータが不足しています
    - 400, `model_currently_not_support`, 現在のモデルが利用できません
    - 400, `workflow_not_found`, 指定されたワークフローバージョンが見つかりません
    - 400, `draft_workflow_error`, ドラフトワークフローバージョンは使用できません
    - 400, `workflow_id_format_error`, ワークフローID形式エラー、UUID形式が必要です
    - 400, `completion_request_error`, テキスト生成に失敗しました
    - 500, 内部サーバーエラー

  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="POST"
      label="/chat-messages"
      targetCode={`curl -X POST '${props.appDetail.api_base_url}/chat-messages' \\
--header 'Authorization: Bearer {api_key}' \\
--header 'Content-Type: application/json' \\
--data-raw '{
    "inputs": ${JSON.stringify(props.inputs)},
    "query": "What are the specs of the iPhone 13 Pro Max?",
    "response_mode": "streaming",
    "conversation_id": "",
    "user": "abc-123",
    "files": [
        {
            "type": "image",
            "transfer_method": "remote_url",
            "url": "https://cloud.dify.ai/logo/logo-site.png"
        }
    ]
}'`}
    />
    ### ブロッキングモード
    <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
        "event": "message",
        "task_id": "c3800678-a077-43df-a102-53f23ed20b88",
        "id": "9da23599-e713-473b-982c-4328d4f5c78a",
        "message_id": "9da23599-e713-473b-982c-4328d4f5c78a",
        "conversation_id": "45701982-8118-4bc5-8e9b-64562b4555f2",
        "mode": "chat",
        "answer": "iPhone 13 Pro Maxの仕様は次のとおりです:...",
        "metadata": {
            "usage": {
                "prompt_tokens": 1033,
                "prompt_unit_price": "0.001",
                "prompt_price_unit": "0.001",
                "prompt_price": "0.0010330",
                "completion_tokens": 128,
                "completion_unit_price": "0.002",
                "completion_price_unit": "0.001",
                "completion_price": "0.0002560",
                "total_tokens": 1161,
                "total_price": "0.0012890",
                "currency": "USD",
                "latency": 0.7682376249867957
            },
            "retriever_resources": [
                {
                    "position": 1,
                    "dataset_id": "101b4c97-fc2e-463c-90b1-5261a4cdcafb",
                    "dataset_name": "iPhone",
                    "document_id": "8dd1ad74-0b5f-4175-b735-7d98bbbb4e00",
                    "document_name": "iPhone List",
                    "segment_id": "ed599c7f-2766-4294-9d1d-e5235a61270a",
                    "score": 0.98457545,
                    "content": "\"Model\",\"Release Date\",\"Display Size\",\"Resolution\",\"Processor\",\"RAM\",\"Storage\",\"Camera\",\"Battery\",\"Operating System\"\n\"iPhone 13 Pro Max\",\"September 24, 2021\",\"6.7 inch\",\"1284 x 2778\",\"Hexa-core (2x3.23 GHz Avalanche + 4x1.82 GHz Blizzard)\",\"6 GB\",\"128, 256, 512 GB, 1TB\",\"12 MP\",\"4352 mAh\",\"iOS 15\""
                }
            ]
        },
        "created_at": 1705407629
    }
    ```
    </CodeGroup>
    ### ストリーミングモード
    <CodeGroup title="応答">
    ```streaming {{ title: '応答' }}
      data: {"event": "workflow_started", "task_id": "5ad4cb98-f0c7-4085-b384-88c403be6290", "workflow_run_id": "5ad498-f0c7-4085-b384-88cbe6290", "data": {"id": "5ad498-f0c7-4085-b384-88cbe6290", "workflow_id": "dfjasklfjdslag", "created_at": 1679586595}}
      data: {"event": "node_started", "task_id": "5ad4cb98-f0c7-4085-b384-88c403be6290", "workflow_run_id": "5ad498-f0c7-4085-b384-88cbe6290", "data": {"id": "5ad498-f0c7-4085-b384-88cbe6290", "node_id": "dfjasklfjdslag", "node_type": "start", "title": "Start", "index": 0, "predecessor_node_id": "fdljewklfklgejlglsd", "inputs": {}, "created_at": 1679586595}}
      data: {"event": "node_finished", "task_id": "5ad4cb98-f0c7-4085-b384-88c403be6290", "workflow_run_id": "5ad498-f0c7-4085-b384-88cbe6290", "data": {"id": "5ad498-f0c7-4085-b384-88cbe6290", "node_id": "dfjasklfjdslag", "node_type": "start", "title": "Start", "index": 0, "predecessor_node_id": "fdljewklfklgejlglsd", "inputs": {}, "outputs": {}, "status": "succeeded", "elapsed_time": 0.324, "execution_metadata": {"total_tokens": 63127864, "total_price": 2.378, "currency": "USD"},  "created_at": 1679586595}}
      data: {"event": "workflow_finished", "task_id": "5ad4cb98-f0c7-4085-b384-88c403be6290", "workflow_run_id": "5ad498-f0c7-4085-b384-88cbe6290", "data": {"id": "5ad498-f0c7-4085-b384-88cbe6290", "workflow_id": "dfjasklfjdslag", "outputs": {}, "status": "succeeded", "elapsed_time": 0.324, "total_tokens": 63127864, "total_steps": "1", "created_at": 1679586595, "finished_at": 1679976595}}
      data: {"event": "message", "message_id": "5ad4cb98-f0c7-4085-b384-88c403be6290", "conversation_id": "45701982-8118-4bc5-8e9b-64562b4555f2", "answer": " I", "created_at": 1679586595}
      data: {"event": "message", "message_id": "5ad4cb98-f0c7-4085-b384-88c403be6290", "conversation_id": "45701982-8118-4bc5-8e9b-64562b4555f2", "answer": "'m", "created_at": 1679586595}
      data: {"event": "message", "message_id": "5ad4cb98-f0c7-4085-b384-88c403be6290", "conversation_id": "45701982-8118-4bc5-8e9b-64562b4555f2", "answer": " glad", "created_at": 1679586595}
      data: {"event": "message", "message_id": "5ad4cb98-f0c7-4085-b384-88c403be6290", "conversation_id": "45701982-8118-4bc5-8e9b-64562b4555f2", "answer": " to", "created_at": 1679586595}
      data: {"event": "message", "message_id" : "5ad4cb98-f0c7-4085-b384-88c403be6290", "conversation_id": "45701982-8118-4bc5-8e9b-64562b4555f2", "answer": " meet", "created_at": 1679586595}
      data: {"event": "message", "message_id" : "5ad4cb98-f0c7-4085-b384-88c403be6290", "conversation_id": "45701982-8118-4bc5-8e9b-64562b4555f2", "answer": " you", "created_at": 1679586595}
      data: {"event": "message_end", "id": "5e52ce04-874b-4d27-9045-b3bc80def685", "conversation_id": "45701982-8118-4bc5-8e9b-64562b4555f2", "metadata": {"usage": {"prompt_tokens": 1033, "prompt_unit_price": "0.001", "prompt_price_unit": "0.001", "prompt_price": "0.0010330", "completion_tokens": 135, "completion_unit_price": "0.002", "completion_price_unit": "0.001", "completion_price": "0.0002700", "total_tokens": 1168, "total_price": "0.0013030", "currency": "USD", "latency": 1.381760165997548}, "retriever_resources": [{"position": 1, "dataset_id": "101b4c97-fc2e-463c-90b1-5261a4cdcafb", "dataset_name": "iPhone", "document_id": "8dd1ad74-0b5f-4175-b735-7d98bbbb4e00", "document_name": "iPhone List", "segment_id": "ed599c7f-2766-4294-9d1d-e5235a61270a", "score": 0.98457545, "content": "\"Model\",\"Release Date\",\"Display Size\",\"Resolution\",\"Processor\",\"RAM\",\"Storage\",\"Camera\",\"Battery\",\"Operating System\"\n\"iPhone 13 Pro Max\",\"September 24, 2021\",\"6.7 inch\",\"1284 x 2778\",\"Hexa-core (2x3.23 GHz Avalanche + 4x1.82 GHz Blizzard)\",\"6 GB\",\"128, 256, 512 GB, 1TB\",\"12 MP\",\"4352 mAh\",\"iOS 15\""}]}}
      data: {"event": "tts_message", "conversation_id": "23dd85f3-1a41-4ea0-b7a9-062734ccfaf9", "message_id": "a8bdc41c-13b2-4c18-bfd9-054b9803038c", "created_at": 1721205487, "task_id": "3bf8a0bb-e73b-4690-9e66-4e429bad8ee7", "audio": "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"}
      data: {"event": "tts_message_end", "conversation_id": "23dd85f3-1a41-4ea0-b7a9-062734ccfaf9", "message_id": "a8bdc41c-13b2-4c18-bfd9-054b9803038c", "created_at": 1721205487, "task_id": "3bf8a0bb-e73b-4690-9e66-4e429bad8ee7", "audio": ""}
    ```
    </CodeGroup>

  </Col>
</Row>

---
<Heading
  url='/files/upload'
  method='POST'
  title='ファイルアップロード'
  name='#file-upload'
/>
<Row>
  <Col>
  メッセージ送信時に使用するファイルをアップロードし、画像とテキストのマルチモーダル理解を可能にします。
  アプリケーションでサポートされている形式をサポートします。
  アップロードされたファイルは現在のエンドユーザーのみが使用できます。

  ### リクエストボディ
  このインターフェースは`multipart/form-data`リクエストを必要とします。
  - `file` (File) 必須
    アップロードするファイル。
  - `user` (string) 必須
    ユーザー識別子、開発者のルールによって定義され、アプリケーション内で一意でなければなりません。サービス API は WebApp によって作成された会話を共有しません。

  ### 応答
  アップロードが成功すると、サーバーはファイルの ID と関連情報を返します。
  - `id` (uuid) ID
  - `name` (string) ファイル名
  - `size` (int) ファイルサイズ（バイト）
  - `extension` (string) ファイル拡張子
  - `mime_type` (string) ファイルの MIME タイプ
  - `created_by` (uuid) エンドユーザーID
  - `created_at` (timestamp) 作成タイムスタンプ、例：1705395332

  ### エラー
  - 400, `no_file_uploaded`, ファイルが提供されなければなりません
  - 400, `too_many_files`, 現在は 1 つのファイルのみ受け付けます
  - 400, `unsupported_preview`, ファイルはプレビューをサポートしていません
  - 400, `unsupported_estimate`, ファイルは推定をサポートしていません
  - 413, `file_too_large`, ファイルが大きすぎます
  - 415, `unsupported_file_type`, サポートされていない拡張子、現在はドキュメントファイルのみ受け付けます
  - 503, `s3_connection_failed`, S3 サービスに接続できません
  - 503, `s3_permission_denied`, S3 にファイルをアップロードする権限がありません
  - 503, `s3_file_too_large`, ファイルが S3 のサイズ制限を超えています
  - 500, 内部サーバーエラー


  </Col>
  <Col sticky>
  ### リクエスト例

  <CodeGroup
    title="リクエスト"
    tag="POST"
    label="/files/upload"
    targetCode={`curl -X POST '${props.appDetail.api_base_url}/files/upload' \\
--header 'Authorization: Bearer {api_key}' \\
--form 'file=@localfile;type=image/[png|jpeg|jpg|webp|gif]' \\
--form 'user=abc-123'`}
  />

  ### 応答例
  <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
      "id": "72fa9618-8f89-4a37-9b33-7e1178a24a67",
      "name": "example.png",
      "size": 1024,
      "extension": "png",
      "mime_type": "image/png",
      "created_by": "6ad1ab0a-73ff-4ac1-b9e4-cdb312f71f13",
      "created_at": 1577836800,
    }
  ```
  </CodeGroup>
  </Col>
</Row>
---

<Heading
  url='/files/:file_id/preview'
  method='GET'
  title='ファイルプレビュー'
  name='#file-preview'
/>
<Row>
  <Col>
    アップロードされたファイルをプレビューまたはダウンロードします。このエンドポイントを使用すると、以前にファイルアップロード API でアップロードされたファイルにアクセスできます。

    <i>ファイルは、リクエストしているアプリケーションのメッセージ範囲内にある場合のみアクセス可能です。</i>

    ### パスパラメータ
    - `file_id` (string) 必須
      プレビューするファイルの一意識別子。ファイルアップロード API レスポンスから取得します。

    ### クエリパラメータ
    - `as_attachment` (boolean) オプション
      ファイルを添付ファイルとして強制ダウンロードするかどうか。デフォルトは `false`（ブラウザでプレビュー）。

    ### レスポンス
    ブラウザ表示またはダウンロード用の適切なヘッダー付きでファイル内容を返します。
    - `Content-Type` ファイル MIME タイプに基づいて設定
    - `Content-Length` ファイルサイズ（バイト、利用可能な場合）
    - `Content-Disposition` `as_attachment=true` の場合は "attachment" に設定
    - `Cache-Control` パフォーマンス向上のためのキャッシュヘッダー
    - `Accept-Ranges` 音声/動画ファイルの場合は "bytes" に設定

    ### エラー
    - 400, `invalid_param`, パラメータ入力異常
    - 403, `file_access_denied`, ファイルアクセス拒否またはファイルが現在のアプリケーションに属していません
    - 404, `file_not_found`, ファイルが見つからないか削除されています
    - 500, サーバー内部エラー

  </Col>
  <Col sticky>
    ### リクエスト例
    <CodeGroup
      title="リクエスト"
      tag="GET"
      label="/files/:file_id/preview"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/files/72fa9618-8f89-4a37-9b33-7e1178a24a67/preview' \\
--header 'Authorization: Bearer {api_key}'`}
    />

    ### 添付ファイルとしてダウンロード
    <CodeGroup
      title="ダウンロードリクエスト"
      tag="GET"
      label="/files/:file_id/preview?as_attachment=true"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/files/72fa9618-8f89-4a37-9b33-7e1178a24a67/preview?as_attachment=true' \\
--header 'Authorization: Bearer {api_key}' \\
--output downloaded_file.png`}
    />

    ### レスポンスヘッダー例
    <CodeGroup title="Response Headers">
    ```http {{ title: 'ヘッダー - 画像プレビュー' }}
    Content-Type: image/png
    Content-Length: 1024
    Cache-Control: public, max-age=3600
    ```
    </CodeGroup>

    ### ダウンロードレスポンスヘッダー
    <CodeGroup title="Download Response Headers">
    ```http {{ title: 'ヘッダー - ファイルダウンロード' }}
    Content-Type: image/png
    Content-Length: 1024
    Content-Disposition: attachment; filename*=UTF-8''example.png
    Cache-Control: public, max-age=3600
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/chat-messages/:task_id/stop'
  method='POST'
  title='生成を停止'
  name='#stop-generatebacks'
/>
<Row>
  <Col>
  ストリーミングモードでのみサポートされています。
  ### パス
  - `task_id` (string) タスク ID、ストリーミングチャンクの返り値から取得できます
  ### リクエストボディ
  - `user` (string) 必須
    ユーザー識別子、エンドユーザーの身元を定義するために使用され、送信メッセージインターフェースで渡されたユーザーと一致している必要があります。サービス API は WebApp によって作成された会話を共有しません。
  ### 応答
  - `result` (string) 常に"success"を返します
  </Col>
  <Col sticky>
  ### リクエスト例
    <CodeGroup
      title="リクエスト"
      tag="POST"
      label="/chat-messages/:task_id/stop"
      targetCode={`curl -X POST '${props.appDetail.api_base_url}/chat-messages/:task_id/stop' \\
-H 'Authorization: Bearer {api_key}' \\
-H 'Content-Type: application/json' \\
--data-raw '{
    "user": "abc-123"
}'`}
    />
    ### 応答例
    <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
      "result": "success"
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/messages/:message_id/feedbacks'
  method='POST'
  title='メッセージフィードバック'
  name='#feedbacks'
/>
<Row>
  <Col>
    エンドユーザーはフィードバックメッセージを提供でき、アプリケーション開発者が期待される出力を最適化するのを支援します。

    ### パス
    <Properties>
      <Property name='message_id' type='string' key='message_id'>
       メッセージID
      </Property>
    </Properties>

    ### リクエストボディ

    <Properties>
      <Property name='rating' type='string' key='rating'>
        アップボートは`like`、ダウンボートは`dislike`、アップボートの取り消しは`null`
      </Property>
      <Property name='user' type='string' key='user'>
        ユーザー識別子、開発者のルールによって定義され、アプリケーション内で一意でなければなりません。
      </Property>
      <Property name='content' type='string' key='content'>
        メッセージのフィードバックです。
      </Property>
    </Properties>

    ### 応答
    - `result` (string) 常に"success"を返します
  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="POST"
      label="/messages/:message_id/feedbacks"
      targetCode={`curl -X POST '${props.appDetail.api_base_url}/messages/:message_id/feedbacks' \\
--header 'Authorization: Bearer {api_key}' \\
--header 'Content-Type: application/json' \\
--data-raw '{
    "rating": "like",
    "user": "abc-123",
    "content": "message feedback information"
}'`}
    />

    <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
      "result": "success"
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/app/feedbacks'
  method='GET'
  title='アプリのメッセージの「いいね」とフィードバックを取得'
  name='#app-feedbacks'
/>
<Row>
  <Col>
    アプリのエンドユーザーからのフィードバックや「いいね」を取得します。

    ### クエリ
    <Properties>
      <Property name='page' type='string' key='page'>
       （任意）ページ番号。デフォルト値：1
      </Property>
    </Properties>

    <Properties>
      <Property name='limit' type='string' key='limit'>
       （任意）1ページあたりの件数。デフォルト値：20
      </Property>
    </Properties>

    ### レスポンス
    - `data` (リスト) このアプリの「いいね」とフィードバックの一覧を返します。
  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="GET"
      label="/app/feedbacks"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/app/feedbacks?page=1&limit=20' \\
--header 'Authorization: Bearer {api_key}' \\
--header 'Content-Type: application/json'`}
    />

    <CodeGroup title="Response">
    ```json {{ title: 'Response' }}
        {
        "data": [
            {
                "id": "8c0fbed8-e2f9-49ff-9f0e-15a35bdd0e25",
                "app_id": "f252d396-fe48-450e-94ec-e184218e7346",
                "conversation_id": "2397604b-9deb-430e-b285-4726e51fd62d",
                "message_id": "709c0b0f-0a96-4a4e-91a4-ec0889937b11",
                "rating": "like",
                "content": "message feedback information-3",
                "from_source": "user",
                "from_end_user_id": "74286412-9a1a-42c1-929c-01edb1d381d5",
                "from_account_id": null,
                "created_at": "2025-04-24T09:24:38",
                "updated_at": "2025-04-24T09:24:38"
            }
        ]
        }
    ```
    </CodeGroup>
  </Col>
</Row>
---


<Heading
  url='/messages/{message_id}/suggested'
  method='GET'
  title='次の推奨質問'
  name='#suggested'
/>
<Row>
  <Col>
    現在のメッセージに対する次の質問の提案を取得します

    ### パスパラメータ

    <Properties>
      <Property name='message_id' type='string' key='message_id'>
        メッセージID
      </Property>
    </Properties>

    ### クエリ
    <Properties>
      <Property name='user' type='string' key='user'>
        ユーザー識別子、エンドユーザーの身元を定義するために使用され、統計のために使用されます。
        アプリケーション内で開発者によって一意に定義されるべきです。
      </Property>
    </Properties>
  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="GET"
      label="/messages/{message_id}/suggested"
      targetCode={`curl --location --request GET '${props.appDetail.api_base_url}/messages/{message_id}/suggested?user=abc-123' \\
--header 'Authorization: Bearer ENTER-YOUR-SECRET-KEY' \\
--header 'Content-Type: application/json'`}
    />

    <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
      "result": "success",
      "data": [
            "a",
            "b",
            "c"
        ]
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/messages'
  method='GET'
  title='会話履歴メッセージを取得'
  name='#messages'
/>
<Row>
  <Col>
    スクロールロード形式で履歴チャット記録を返し、最初のページは最新の`{limit}`メッセージを返します。つまり、逆順です。

    ### クエリ

    <Properties>
      <Property name='conversation_id' type='string' key='conversation_id'>
        会話ID
      </Property>
      <Property name='user' type='string' key='user'>
        ユーザー識別子、エンドユーザーの身元を定義するために使用され、統計のために使用されます。
        アプリケーション内で開発者によって一意に定義されるべきです。
      </Property>
      <Property name='first_id' type='string' key='first_id'>
          現在のページの最初のチャット記録のID、デフォルトはnullです。
      </Property>
      <Property name='limit' type='int' key='limit'>
          1回のリクエストで返すチャット履歴メッセージの数、デフォルトは20です。
      </Property>
    </Properties>

    ### 応答
    - `data` (array[object]) メッセージリスト
      - `id` (string) メッセージID
      - `conversation_id` (string) 会話ID
      - `inputs` (object) ユーザー入力パラメータ。
      - `query` (string) ユーザー入力/質問内容。
      - `message_files` (array[object]) メッセージファイル
        - `id` (string) ID
        - `type` (string) ファイルタイプ、画像の場合はimage
        - `url` (string) ファイルプレビューURL、ファイルアクセスにはファイルプレビューAPI（`/files/{file_id}/preview`）を使用してください
        - `belongs_to` (string) 所属、userまたはassistant
      - `answer` (string) 応答メッセージ内容
      - `created_at` (timestamp) 作成タイムスタンプ、例：1705395332
      - `feedback` (object) フィードバック情報
        - `rating` (string) アップボートは`like` / ダウンボートは`dislike`
      - `retriever_resources` (array[RetrieverResource]) 引用と帰属リスト
    - `has_more` (bool) 次のページがあるかどうか
    - `limit` (int) 返された項目数、入力がシステム制限を超える場合、システム制限数を返します

  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="GET"
      label="/messages"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/messages?user=abc-123&conversation_id={conversation_id}'
--header 'Authorization: Bearer {api_key}'`}
    />
    ### 応答例
    <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
      "limit": 20,
      "has_more": false,
      "data": [
        {
            "id": "a076a87f-31e5-48dc-b452-0061adbbc922",
            "conversation_id": "cd78daf6-f9e4-4463-9ff2-54257230a0ce",
            "inputs": {
                "name": "dify"
            },
            "query": "iphone 13 pro",
            "answer": "iPhone 13 Proは2021年9月24日に発売され、6.1インチのディスプレイと1170 x 2532の解像度を備えています。Hexa-core (2x3.23 GHz Avalanche + 4x1.82 GHz Blizzard)プロセッサ、6 GBのRAMを搭載し、128 GB、256 GB、512 GB、1 TBのストレージオプションを提供します。カメラは12 MP、バッテリー容量は3095 mAhで、iOS 15を搭載しています。",
            "message_files": [],
            "feedback": null,
            "retriever_resources": [
                {
                    "position": 1,
                    "dataset_id": "101b4c97-fc2e-463c-90b1-5261a4cdcafb",
                    "dataset_name": "iPhone",
                    "document_id": "8dd1ad74-0b5f-4175-b735-7d98bbbb4e00",
                    "document_name": "iPhone List",
                    "segment_id": "ed599c7f-2766-4294-9d1d-e5235a61270a",
                    "score": 0.98457545,
                    "content": "\"Model\",\"Release Date\",\"Display Size\",\"Resolution\",\"Processor\",\"RAM\",\"Storage\",\"Camera\",\"Battery\",\"Operating System\"\n\"iPhone 13 Pro Max\",\"September 24, 2021\",\"6.7 inch\",\"1284 x 2778\",\"Hexa-core (2x3.23 GHz Avalanche + 4x1.82 GHz Blizzard)\",\"6 GB\",\"128, 256, 512 GB, 1TB\",\"12 MP\",\"4352 mAh\",\"iOS 15\""
                }
            ],
            "created_at": 1705569239,
        }
      ]
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/conversations'
  method='GET'
  title='会話を取得'
  name='#conversations'
/>
<Row>
  <Col>
    現在のユーザーの会話リストを取得し、デフォルトで最新の 20 件を返します。

    ### クエリ

    <Properties>
      <Property name='user' type='string' key='user'>
          ユーザー識別子、エンドユーザーの身元を定義するために使用され、統計のために使用されます。
          アプリケーション内で開発者によって一意に定義されるべきです。
      </Property>
      <Property name='last_id' type='string' key='last_id'>
          (Optional)現在のページの最後の記録のID、デフォルトはnullです。
      </Property>
      <Property name='limit' type='int' key='limit'>
          (Optional)1回のリクエストで返す記録の数、デフォルトは最新の20件です。最大100、最小1。
      </Property>
      <Property name='sort_by' type='string' key='sort_by'>
        (Optional)ソートフィールド、デフォルト：-updated_at（更新時間で降順にソート）
        - 利用可能な値：created_at, -created_at, updated_at, -updated_at
        - フィールドの前の記号は順序または逆順を表し、"-"は逆順を表します。
      </Property>
    </Properties>

    ### 応答
    - `data` (array[object]) 会話のリスト
      - `id` (string) 会話ID
      - `name` (string) 会話名、デフォルトではLLMによって生成されます。
      - `inputs` (object) ユーザー入力パラメータ。
      - `introduction` (string) 紹介
      - `created_at` (timestamp) 作成タイムスタンプ、例：1705395332
      - `updated_at` (timestamp) 更新タイムスタンプ、例：1705395332
    - `has_more` (bool)
    - `limit` (int) 返されたエントリ数、入力がシステム制限を超える場合、システム制限数が返されます

  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="GET"
      label="/conversations"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/conversations?user=abc-123&last_id=&limit=20' \\
--header 'Authorization: Bearer {api_key}'`}
    />

    <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
      "limit": 20,
      "has_more": false,
      "data": [
        {
          "id": "10799fb8-64f7-4296-bbf7-b42bfbe0ae54",
          "name": "新しいチャット",
          "inputs": {
              "book": "book",
              "myName": "Lucy"
          },
          "status": "normal",
          "created_at": 1679667915,
          "updated_at": 1679667915
        },
        {
          "id": "hSIhXBhNe8X1d8Et"
          // ...
        }
      ]
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/conversations/:conversation_id'
  method='DELETE'
  title='会話を削除'
  name='#delete'
/>
<Row>
  <Col>
    会話を削除します。

    ### パス
    - `conversation_id` (string) 会話ID

    ### リクエストボディ

    <Properties>
      <Property name='user' type='string' key='user'>
        ユーザー識別子、開発者によって定義され、アプリケーション内で一意であることを保証しなければなりません。
      </Property>
    </Properties>

    ### 応答
    - `result` (string) 常に"success"を返します
  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="DELETE"
      label="/conversations/:conversation_id"
      targetCode={`curl -X DELETE '${props.appDetail.api_base_url}/conversations/{conversation_id}' \\
--header 'Content-Type: application/json' \\
--header 'Accept: application/json' \\
--header 'Authorization: Bearer {api_key}' \\
--data '{
    "user": "abc-123"
}'`}
    />

    <CodeGroup title="応答">
    ```text {{ title: '応答' }}
    204 No Content
    ```
    </CodeGroup>
  </Col>
</Row>

---
<Heading
  url='/conversations/:conversation_id/name'
  method='POST'
  title='会話の名前を変更'
  name='#rename'
/>
<Row>
  <Col>
    ### リクエストボディ
    セッションの名前を変更します。セッション名は、複数のセッションをサポートするクライアントでの表示に使用されます。

    ### パス
    - `conversation_id` (string) 会話ID

    <Properties>
      <Property name='name' type='string' key='name'>
        (Optional)会話の名前。`auto_generate`が`true`に設定されている場合、このパラメータは省略できます。
      </Property>
      <Property name='auto_generate' type='bool' key='auto_generate'>
        (Optional)タイトルを自動生成、デフォルトは`false`
      </Property>
      <Property name='user' type='string' key='user'>
        ユーザー識別子、開発者によって定義され、アプリケーション内で一意であることを保証しなければなりません。
      </Property>
    </Properties>

    ### 応答
    - `id` (string) 会話ID
    - `name` (string) 会話名
    - `inputs` (object) ユーザー入力パラメータ
    - `status` (string) 会話状態
    - `introduction` (string) 紹介
    - `created_at` (timestamp) 作成タイムスタンプ、例：1705395332
    - `updated_at` (timestamp) 更新タイムスタンプ、例：1705395332
  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="POST"
      label="/conversations/:conversation_id/name"
      targetCode={`curl -X POST '${props.appDetail.api_base_url}/conversations/{conversation_id}/name' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer {api_key}' \\
--data-raw '{
    "name": "",
    "auto_generate": true,
    "user": "abc-123"
}'`}
    />

    <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
        "id": "cd78daf6-f9e4-4463-9ff2-54257230a0ce",
        "name": "チャット vs AI",
        "inputs": {},
        "status": "normal",
        "introduction": "",
        "created_at": 1705569238,
        "updated_at": 1705569238
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/conversations/:conversation_id/variables'
  method='GET'
  title='会話変数の取得'
  name='#conversation-variables'
/>
<Row>
  <Col>
    特定の会話から変数を取得します。このエンドポイントは、会話中に取得された構造化データを抽出するのに役立ちます。

    ### パスパラメータ

    <Properties>
      <Property name='conversation_id' type='string' key='conversation_id'>
        変数を取得する会話のID。
      </Property>
    </Properties>

    ### クエリパラメータ

    <Properties>
      <Property name='user' type='string' key='user'>
        ユーザー識別子。開発者によって定義されたルールに従い、アプリケーション内で一意である必要があります。
      </Property>
      <Property name='last_id' type='string' key='last_id'>
          (Optional)現在のページの最後の記録のID、デフォルトはnullです。
      </Property>
      <Property name='limit' type='int' key='limit'>
          (Optional)1回のリクエストで返す記録の数、デフォルトは最新の20件です。最大100、最小1。
      </Property>
    </Properties>

    ### レスポンス

    - `limit` (int) ページごとのアイテム数
    - `has_more` (bool) さらにアイテムがあるかどうか
    - `data` (array[object]) 変数のリスト
      - `id` (string) 変数 ID
      - `name` (string) 変数名
      - `value_type` (string) 変数タイプ（文字列、数値、真偽値など）
      - `value` (string) 変数値
      - `description` (string) 変数の説明
      - `created_at` (int) 作成タイムスタンプ
      - `updated_at` (int) 最終更新タイムスタンプ

    ### エラー
    - 404, `conversation_not_exists`, 会話が見つかりません

  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="GET"
      label="/conversations/:conversation_id/variables"
      debug="true"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/conversations/{conversation_id}/variables?user=abc-123' \\
--header 'Authorization: Bearer {api_key}'`} />

    <CodeGroup
      title="変数名フィルター付きリクエスト"
      language="bash"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/conversations/{conversation_id}/variables?user=abc-123&variable_name=customer_name' \\
--header 'Authorization: Bearer {api_key}'`}
    />

    <CodeGroup title="Response">
    ```json {{ title: 'Response' }}
    {
      "limit": 100,
      "has_more": false,
      "data": [
        {
          "id": "variable-uuid-1",
          "name": "customer_name",
          "value_type": "string",
          "value": "John Doe",
          "description": "会話から抽出された顧客名",
          "created_at": 1650000000000,
          "updated_at": 1650000000000
        },
        {
          "id": "variable-uuid-2",
          "name": "order_details",
          "value_type": "json",
          "value": "{\"product\":\"Widget\",\"quantity\":5,\"price\":19.99}",
          "description": "顧客の注文詳細",
          "created_at": 1650000000000,
          "updated_at": 1650000000000
        }
      ]
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/conversations/:conversation_id/variables/:variable_id'
  method='PUT'
  title='会話変数の更新'
  name='#update-conversation-variable'
/>
<Row>
  <Col>
    特定の会話変数の値を更新します。このエンドポイントは、名前、型、説明を保持しながら、会話中にキャプチャされた変数の値を変更することを可能にします。

    ### パスパラメータ

    <Properties>
      <Property name='conversation_id' type='string' key='conversation_id'>
        更新する変数を含む会話のID。
      </Property>
      <Property name='variable_id' type='string' key='variable_id'>
        更新する変数のID。
      </Property>
    </Properties>

    ### リクエストボディ

    <Properties>
      <Property name='value' type='any' key='value'>
        変数の新しい値。変数の期待される型（文字列、数値、オブジェクトなど）と一致する必要があります。
      </Property>
      <Property name='user' type='string' key='user'>
        ユーザー識別子。開発者によって定義されたルールに従い、アプリケーション内で一意である必要があります。
      </Property>
    </Properties>

    ### レスポンス

    以下を含む更新された変数オブジェクトを返します：
    - `id` (string) 変数ID
    - `name` (string) 変数名
    - `value_type` (string) 変数型（文字列、数値、オブジェクトなど）
    - `value` (any) 更新された変数値
    - `description` (string) 変数の説明
    - `created_at` (int) 作成タイムスタンプ
    - `updated_at` (int) 最終更新タイムスタンプ

    ### エラー
    - 400, `Type mismatch: variable expects {expected_type}, but got {actual_type} type`, 値の型が変数の期待される型と一致しません
    - 404, `conversation_not_exists`, 会話が見つかりません
    - 404, `conversation_variable_not_exists`, 変数が見つかりません

  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="PUT"
      label="/conversations/:conversation_id/variables/:variable_id"
      targetCode={`curl -X PUT '${props.appDetail.api_base_url}/conversations/{conversation_id}/variables/{variable_id}' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer {api_key}' \\
--data-raw '{
    "value": "Updated Value",
    "user": "abc-123"
}'`}
    />

    <CodeGroup
      title="異なる値型での更新"
      targetCode={[
        {
          title: '文字列値',
          code: `curl -X PUT '${props.appDetail.api_base_url}/conversations/{conversation_id}/variables/{variable_id}' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer {api_key}' \\
--data-raw '{
    "value": "新しい文字列値",
    "user": "abc-123"
}'`,
        }, {
          title: '数値',
          code: `curl -X PUT '${props.appDetail.api_base_url}/conversations/{conversation_id}/variables/{variable_id}' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer {api_key}' \\
--data-raw '{
    "value": 42,
    "user": "abc-123"
}'`,
        }, {
          title: 'オブジェクト値',
          code: `curl -X PUT '${props.appDetail.api_base_url}/conversations/{conversation_id}/variables/{variable_id}' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer {api_key}' \\
--data-raw '{
    "value": {"product": "Widget", "quantity": 10, "price": 29.99},
    "user": "abc-123"
}'`,
        },
      ]}
    />

    <CodeGroup title="Response">
    ```json {{ title: 'Response' }}
    {
      "id": "variable-uuid-1",
      "name": "customer_name",
      "value_type": "string",
      "value": "Updated Value",
      "description": "会話から抽出された顧客名",
      "created_at": 1650000000000,
      "updated_at": 1650000001000
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/audio-to-text'
  method='POST'
  title='音声からテキストへ'
  name='#audio-to-text'
/>
<Row>
  <Col>
    このエンドポイントは multipart/form-data リクエストを必要とします。

    ### リクエストボディ

    <Properties>
      <Property name='file' type='file' key='file'>
        オーディオファイル。
        サポートされている形式：`['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm']`
        ファイルサイズ制限：15MB
      </Property>
      <Property name='user' type='string' key='user'>
      ユーザー識別子、開発者のルールによって定義され、アプリケーション内で一意でなければなりません。
      </Property>
    </Properties>

    ### 応答
    - `text` (string) 出力テキスト

  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="POST"
      label="/audio-to-text"
      targetCode={`curl -X POST '${props.appDetail.api_base_url}/audio-to-text' \\
--header 'Authorization: Bearer {api_key}' \\
--form 'file=@localfile;type=audio/[mp3|mp4|mpeg|mpga|m4a|wav|webm]'`}
    />

    <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
      "text": ""
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/text-to-audio'
  method='POST'
  title='テキストから音声へ'
  name='#text-to-audio'
/>
<Row>
  <Col>
    テキストを音声に変換します。

    ### リクエストボディ

    <Properties>
      <Property name='message_id' type='str' key='message_id'>
        Difyによって生成されたテキストメッセージの場合、生成されたメッセージIDを直接渡します。バックエンドはメッセージIDを使用して対応する内容を検索し、音声情報を直接合成します。message_idとtextが同時に提供される場合、message_idが優先されます。
      </Property>
      <Property name='text' type='str' key='text'>
        音声生成コンテンツ。
      </Property>
      <Property name='user' type='string' key='user'>
        ユーザー識別子、開発者によって定義され、アプリ内で一意であることを保証しなければなりません。
      </Property>
    </Properties>
  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="POST"
      label="/text-to-audio"
      targetCode={`curl -o text-to-audio.mp3 -X POST '${props.appDetail.api_base_url}/text-to-audio' \\
--header 'Authorization: Bearer {api_key}' \\
--header 'Content-Type: application/json' \\
--data-raw '{
    "message_id": "5ad4cb98-f0c7-4085-b384-88c403be6290",
    "text": "Hello Dify",
    "user": "abc-123",
}'`}
    />

    <CodeGroup title="ヘッダー">
    ```json {{ title: 'ヘッダー' }}
    {
      "Content-Type": "audio/wav"
    }
    ```
    </CodeGroup>
  </Col>
</Row>
---

<Heading
  url='/info'
  method='GET'
  title='アプリケーションの基本情報を取得'
  name='#info'
/>
<Row>
  <Col>
  このアプリケーションの基本情報を取得するために使用されます

  ### Response
  - `name` (string) アプリケーションの名前
  - `description` (string) アプリケーションの説明
  - `tags` (array[string]) アプリケーションのタグ
  - `mode` (string) アプリケーションのモード
  - `author_name` (string) 作者の名前
  </Col>
  <Col>
    <CodeGroup
      title="リクエスト"
      tag="GET"
      label="/info"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/info' \\
-H 'Authorization: Bearer {api_key}'`}
    />

    <CodeGroup title="Response">
    ```json {{ title: 'Response' }}
    {
      "name": "My App",
      "description": "This is my app.",
      "tags": [
        "tag1",
        "tag2"
      ],
      "mode": "advanced-chat",
      "author_name": "Dify"
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/parameters'
  method='GET'
  title='アプリケーションのパラメータ情報を取得'
  name='#parameters'
/>
<Row>
  <Col>
    ページに入る際に、機能、入力パラメータ名、タイプ、デフォルト値などの情報を取得するために使用されます。

    ### 応答
    - `opening_statement` (string) 開始の挨拶
    - `suggested_questions` (array[string]) 開始時の推奨質問のリスト
    - `suggested_questions_after_answer` (object) 答えを有効にした後の質問を提案します。
      - `enabled` (bool) 有効かどうか
    - `speech_to_text` (object) 音声からテキストへ
      - `enabled` (bool) 有効かどうか
    - `text_to_speech` (object) テキストから音声へ
      - `enabled` (bool) 有効かどうか
      - `voice` (string) 音声タイプ
      - `language` (string) 言語
      - `autoPlay` (string) 自動再生
        - `enabled`  有効
        - `disabled` 無効
    - `retriever_resource` (object) 引用と帰属
      - `enabled` (bool) 有効かどうか
    - `annotation_reply` (object) 注釈返信
      - `enabled` (bool) 有効かどうか
    - `user_input_form` (array[object]) ユーザー入力フォームの設定
      - `text-input` (object) テキスト入力コントロール
        - `label` (string) 変数表示ラベル名
        - `variable` (string) 変数ID
        - `required` (bool) 必須かどうか
        - `default` (string) デフォルト値
      - `paragraph` (object) 段落テキスト入力コントロール
        - `label` (string) 変数表示ラベル名
        - `variable` (string) 変数ID
        - `required` (bool) 必須かどうか
        - `default` (string) デフォルト値
      - `select` (object) ドロップダウンコントロール
        - `label` (string) 変数表示ラベル名
        - `variable` (string) 変数ID
        - `required` (bool) 必須かどうか
        - `default` (string) デフォルト値
        - `options` (array[string]) オプション値
    - `file_upload` (object) ファイルアップロード設定
      - `document` (object) ドキュメント設定
        現在サポートされているドキュメントタイプ：`txt`, `md`, `markdown`, `pdf`, `html`, `xlsx`, `xls`, `docx`, `csv`, `eml`, `msg`, `pptx`, `ppt`, `xml`, `epub`。
        - `enabled` (bool) 有効かどうか
        - `number_limits` (int) ドキュメント数の上限。デフォルトは 3
        - `transfer_methods` (array[string]) 転送方法リスト：`remote_url`, `local_file`。いずれかを選択する必要があります。
      - `image` (object) 画像設定
        現在サポートされている画像タイプ：`png`, `jpg`, `jpeg`, `webp`, `gif`。
        - `enabled` (bool) 有効かどうか
        - `number_limits` (int) 画像数の上限。デフォルトは 3
        - `transfer_methods` (array[string]) 転送方法リスト：`remote_url`, `local_file`。いずれかを選択する必要があります。
      - `audio` (object) オーディオ設定
        現在サポートされているオーディオタイプ：`mp3`, `m4a`, `wav`, `webm`, `amr`。
        - `enabled` (bool) 有効かどうか
        - `number_limits` (int) オーディオ数の上限。デフォルトは 3
        - `transfer_methods` (array[string]) 転送方法リスト：`remote_url`, `local_file`。いずれかを選択する必要があります。
      - `video` (object) ビデオ設定
        現在サポートされているビデオタイプ：`mp4`, `mov`, `mpeg`, `mpga`。
        - `enabled` (bool) 有効かどうか
        - `number_limits` (int) ビデオ数の上限。デフォルトは 3
        - `transfer_methods` (array[string]) 転送方法リスト：`remote_url`, `local_file`。いずれかを選択する必要があります。
      - `custom` (object) カスタム設定
        - `enabled` (bool) 有効かどうか
        - `number_limits` (int) カスタム数の上限。デフォルトは 3
        - `transfer_methods` (array[string]) 転送方法リスト：`remote_url`, `local_file`。いずれかを選択する必要があります。
    - `system_parameters` (object) システムパラメータ
      - `file_size_limit` (int) ドキュメントアップロードサイズ制限（MB）
      - `image_file_size_limit` (int) 画像ファイルアップロードサイズ制限（MB）
      - `audio_file_size_limit` (int) オーディオファイルアップロードサイズ制限（MB）
      - `video_file_size_limit` (int) ビデオファイルアップロードサイズ制限（MB）

  </Col>
  <Col sticky>

    <CodeGroup
      title="リクエスト"
      tag="GET"
      label="/parameters"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/parameters'`}
    />

    <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
      "opening_statement": "こんにちは！",
      "suggested_questions_after_answer": {
          "enabled": true
      },
      "speech_to_text": {
          "enabled": true
      },
      "text_to_speech": {
          "enabled": true,
          "voice": "sambert-zhinan-v1",
          "language": "zh-Hans",
          "autoPlay": "disabled"
      },
      "retriever_resource": {
          "enabled": true
      },
      "annotation_reply": {
          "enabled": true
      },
      "user_input_form": [
          {
              "paragraph": {
                  "label": "クエリ",
                  "variable": "query",
                  "required": true,
                  "default": ""
              }
          }
      ],
      "file_upload": {
          "image": {
              "enabled": false,
              "number_limits": 3,
              "detail": "high",
              "transfer_methods": [
                  "remote_url",
                  "local_file"
              ]
          }
      },
      "system_parameters": {
          "file_size_limit": 15,
          "image_file_size_limit": 10,
          "audio_file_size_limit": 50,
          "video_file_size_limit": 100
      }
    }
    ```
    </CodeGroup>
  </Col>
</Row>
---

<Heading
  url='/meta'
  method='GET'
  title='アプリケーションのメタ情報を取得'
  name='#meta'
/>
<Row>
  <Col>
  このアプリケーションのツールのアイコンを取得するために使用されます

  ### 応答
  - `tool_icons`(object[string]) ツールアイコン
    - `tool_name` (string)
      - `icon` (object|string)
        - (object) アイコンオブジェクト
          - `background` (string) 背景色（16 進数形式）
          - `content`(string) 絵文字
        - (string) アイコンの URL
  </Col>
  <Col>

    <CodeGroup
      title="リクエスト"
      tag="GET"
      label="/meta"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/meta' \\
-H 'Authorization: Bearer {api_key}'`}
    />

    <CodeGroup title="応答">
    ```json {{ title: '応答' }}
    {
      "tool_icons": {
        "dalle2": "https://cloud.dify.ai/console/api/workspaces/current/tool-provider/builtin/dalle/icon",
        "api_tool": {
          "background": "#252525",
          "content": "\ud83d\ude01"
        }
      }
    }
    ```
    </CodeGroup>
  </Col>
</Row>

---

<Heading
  url='/site'
  method='GET'
  title='アプリのWebApp設定を取得'
  name='#site'
/>
<Row>
  <Col>
  アプリの WebApp 設定を取得するために使用します。
  ### 応答
  - `title` (string) WebApp 名
  - `chat_color_theme` (string) チャットの色テーマ、16 進数形式
  - `chat_color_theme_inverted` (bool) チャットの色テーマを反転するかどうか
  - `icon_type` (string) アイコンタイプ、`emoji`-絵文字、`image`-画像
  - `icon` (string) アイコン。`emoji`タイプの場合は絵文字、`image`タイプの場合は画像 URL
  - `icon_background` (string) 16 進数形式の背景色
  - `icon_url` (string) アイコンの URL
  - `description` (string) 説明
  - `copyright` (string) 著作権情報
  - `privacy_policy` (string) プライバシーポリシーのリンク
  - `custom_disclaimer` (string) カスタム免責事項
  - `default_language` (string) デフォルト言語
  - `show_workflow_steps` (bool) ワークフローの詳細を表示するかどうか
  - `use_icon_as_answer_icon` (bool) WebApp のアイコンをチャット内の🤖に置き換えるかどうか
  </Col>
  <Col>
    <CodeGroup
      title="リクエスト"
      tag="GET"
      label="/site"
      targetCode={`curl -X GET '${props.appDetail.api_base_url}/site' \\
-H 'Authorization: Bearer {api_key}'`}
    />

    <CodeGroup title="Response">
    ```json {{ title: 'Response' }}
    {
      "title": "My App",
      "chat_color_theme": "#ff4a4a",
      "chat_color_theme_inverted": false,
      "icon_type": "emoji",
      "icon": "😄",
      "icon_background": "#FFEAD5",
      "icon_url": null,
      "description": "This is my app.",
      "copyright": "all rights reserved",
      "privacy_policy": "",
      "custom_disclaimer": "All generated by AI",
      "default_language": "en-US",
      "show_workflow_steps": false,
      "use_icon_as_answer_icon": false,
    }
    ```
    </CodeGroup>
  </Col>
</Row>
___
