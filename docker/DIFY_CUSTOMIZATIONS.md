# Dify 元構成からの変更一覧

このファイルは、Dify 公式のローカルソースコード構成を基準にして、何を何のためにどう変えたかを追うためのメモです。

## ベースにしたもの

- Dify 公式の local source code deployment 構成
- 参照の中心は `dify/docker/docker-compose.yaml` と `.env`

## 主要な変更ファイル

### [docker-compose.yaml](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\docker-compose.yaml)

- `weaviate` を使わず、Postgres 系プロファイルで動くように調整
- `db` 相当を `pgvector` 対応 Postgres に置き換え
- `n8n`、`n8n_runners`、`n8n_bootstrap` を追加
- `ollama`、`ollama_pull` を追加
- `docproc` を追加
- `dify_bootstrap` を追加
- `dozzle` を追加
- `nginx` で `/n8n/` と `/logs/` を中継する前提に変更
- `nginx` で `/inspect/` を docproc の管理者確認画面へ中継
- `api` / `worker` に検索強化用の Python ファイル bind mount を追加

目的:

- 1 回の `docker compose up -d` で周辺サービスも含めて起動するため
- Dify の入口を `nginx` に一本化するため
- ベクトル DB を Postgres に統一するため
- 実回答時の検索経路に対してローカル修正を確実に反映するため

### [.env](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\.env)

- `COMPOSE_PROJECT_NAME` を追加してネットワーク名衝突を回避
- Postgres / pgvector 前提の設定に調整
- Dify / n8n / Ollama / docproc / bootstrap 用の環境変数を追加
- 自動生成された dataset ID / API key を保存する先として利用

目的:

- プロジェクト分離
- 1 回起動後の再起動でも設定を再利用

### [nginx/conf.d/default.conf.template](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\nginx\conf.d\default.conf.template)

- `/n8n/` を n8n へリバースプロキシ
- `/logs/` を Dozzle へリバースプロキシ
- `/inspect/` を docproc の簡易ビューアへリバースプロキシ
- n8n 再生成時でも 502 になりにくいように再解決前提へ調整

目的:

- 外部公開を `nginx` のみに限定するため
- 管理者がローカルでレイアウト解析結果を確認できるようにするため

### [bootstrap/bootstrap.py](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\bootstrap\bootstrap.py)

- Dify 初回管理者を自動作成
- Dify marketplace から Ollama plugin を取得して登録
- Ollama chat / embedding モデルを Dify に登録
- dataset と dataset API key を自動作成
- dataset の `retrieval_model` を `hybrid_search + weighted_score` へ自動設定
- 生成結果を `.env` と `volumes/bootstrap/dify.generated.json` に保存
- Ollama の `:latest` タグ差異でも待機が止まらないように正規化

目的:

- Dify UI の初回手作業をなくすため
- 実回答時の検索方式を毎回手動設定しなくて済むようにするため

### [pgvector/search-tune.sh](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\pgvector\search-tune.sh)

- `codex_normalize_search_text()` と `codex_keywords_search_text()` を追加
- `document_segments` に対して `pg_trgm` / `pg_bigm` index を追加
- 既存の `embedding_*` テーブルに対して、正規化済みテキストの `pg_trgm` / `pg_bigm` index を追加

目的:

- Dify の segment 検索と実回答時の全文検索の両方を、日本語の表記揺れに強くするため

### [api/core/rag/datasource/vdb/pgvector/pgvector.py](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\api\core\rag\datasource\vdb\pgvector\pgvector.py)

- 実回答時の `search_by_full_text()` を raw text 検索から `codex_normalize_search_text()` ベースへ変更
- 回答時の引用整形向けに、retriever resource の `page` を `Retrieval Anchors` と `doc_metadata.references` から補完
- `pg_bigm` 使用時は正規化済み text に対して `=%` と `bigm_similarity()` を適用
- `pg_trgm` fallback 時も正規化済み text に対して `%` と `similarity()` を適用
- 新規 `embedding_*` テーブル作成時に正規化済み全文検索 index も同時に作成

目的:

- Dify の hybrid search が実際に使う PGVector 経路を、日本語寄りに補強するため

### [api/core/rag/datasource/keyword/jieba/jieba_keyword_table_handler.py](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\api\core\rag\datasource\keyword\jieba\jieba_keyword_table_handler.py)

- NFKC 正規化、小文字化、英数/CJK 境界の分離を追加
- 正規表現 token と日本語/CJK n-gram の補助抽出を追加

目的:

- weighted score rerank と keyword 系検索で、日本語や半角カナ混じりの query を拾いやすくするため

### [bootstrap/sandbox-config.yaml](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\bootstrap\sandbox-config.yaml)

- Dify sandbox 初期化用設定を追加

目的:

- 空ボリュームからの初回起動でも sandbox を正常起動させるため

### [initdb/01-init-databases.sql](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\initdb\01-init-databases.sql)

- Dify plugin 用 DB
- n8n 用 DB

を初回作成する SQL を追加

目的:

- 1 回起動で必要 DB を揃えるため

### [ollama/Dockerfile](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\ollama\Dockerfile)

- `apt`、`wget`、`curl` が使える Ollama イメージを用意

目的:

- モデル取得や保守時の最低限の操作性を確保するため

### [ollama/pull-models.sh](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\ollama\pull-models.sh)

- `nomic-embed-text`

を初回起動時に取得

目的:

- embedding model の初回手動 pull をなくすため

補足:

- chat model は Ollama ではなく、LM Studio の OpenAI 互換エンドポイントを使う
- 旧 `qwen2.5:1.5b` は現在の構成では使わない

### [docproc/app/main.py](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\docproc\app\main.py)

- PDF を text-heavy / image-heavy に分岐
- OCR、表抽出、Excel 全シート抽出を実装
- `caption_text` と `context_text` を分離
- `graph / image / photo / table` を分類
- ヘッダー/フッター除去と `page_artifacts` 保存を追加
- ページ全体の bbox 可視化オーバーレイを生成
- `/inspect/` 用の簡易 HTML ビューアと raw file 配信を追加
- `/eval-lock` を追加し、評価中は `/scan` と `/dify/sync-all` が `skipped` を返して dataset を変更しないようにした

目的:

- 軽量構成のまま前処理品質を上げるため
- 管理者が新規投入ファイルの解析結果をローカルで検証できるようにするため
- n8n の定期 workflow を止めずに、評価中の dataset 変動だけを抑止するため

### [docproc/app/dify_sync.py](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\docproc\app\dify_sync.py)

- 処理済み markdown を Dify dataset へ `create-by-text` / `update-by-text` で同期
- `assets`、`references`、`page_count` などを `doc_metadata` として Dify `documents` テーブルへ保存
- `references / referenced_by` を検索しやすい `Retrieval Anchors` 行として markdown 本文にも埋め込み

目的:

- n8n から Dify dataset へ自動投入するため
- 回答時の図表リンク提示を安定させるため

### [api/controllers/service_api/dataset/document.py](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\api\controllers\service_api\dataset\document.py)

- service API の文書作成・更新で `doc_type` と `doc_metadata` を受け取れるように拡張

目的:

- `docproc` が持つ前処理メタデータを Dify 側 document レベルにも保持するため

### [n8n/bootstrap/bootstrap.mjs](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\n8n\bootstrap\bootstrap.mjs)

- n8n owner を自動作成
- workflow を import
- workflow を active 化

目的:

- n8n UI の初回セットアップを減らすため

### [n8n/workflows/knowledge-inbox-sync.json](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\n8n\workflows\knowledge-inbox-sync.json)

- `docproc /scan`
- `docproc /dify/sync-all`

を定期実行する workflow

目的:

- inbox 取り込みから Dify 同期までを自動化するため
- 評価ロック中は docproc 側が `skipped` を返すため、workflow を止めずに評価を安定化するため

### [n8n/knowledge-preprocess-flow.md](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\n8n\knowledge-preprocess-flow.md)

- n8n workflow の説明を追加

目的:

- どこをどう編集すればよいか分かるようにするため

### [README.local-rag.md](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\README.local-rag.md)

- 全体構成
- 公開 URL
- コンテナの役割
- 現在の前処理仕様

を日本語で整理

目的:

- 構成の全体像を後から追いやすくするため

### [TEST_OUTPUTS.md](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\TEST_OUTPUTS.md)

- テスト入力と出力の Windows 側実ファイル位置を一覧化

目的:

- チャットのリンクが開けない場合でも実ファイルへたどり着けるようにするため

### [docproc/app/retrieval_inspect.py](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\docproc\app\retrieval_inspect.py)

- `/inspect/retrieval/` と `/inspect/retrieval/debug` を追加
- query decomposition の結果、文書事前フィルタの採用理由、block 候補をローカル管理画面で確認可能にした
- API 側の `query_decomposition.py` を read-only mount して、inspect 側でも同じ分解ロジックを使うようにした

目的:

- レイアウト解析の後に、検索でどの文書と block が候補になったかを管理者が追跡できるようにするため
- 新しい PDF や画像を投入したときに、前処理だけでなく検索前段の挙動もローカルで検証できるようにするため

### [chat-ui/](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\chat-ui)

- 業務用フロントを追加
- `index.html / styles.css / app.js` と、Dify app API への proxy 用 nginx 設定を作成

目的:

- 管理用の Dify UI を `/` に残したまま、利用者向けチャットを `/chat/` で分離するため
- app token をブラウザへ直接置かずに、サーバ側 proxy で扱うため

### [eval/eval_cases.json](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\eval\eval_cases.json)
### [tools/evaluate_rag.py](C:\Users\haya-\Lab\PrivateProject\xx_Codex_RAG\dify\docker\tools\evaluate_rag.py)

- 定量評価セットと自動採点スクリプトを追加
- retrieval と chat を分けて採点し、JSON / Markdown レポートを出力するようにした

目的:

- 感覚ではなく、検索精度と回答精度を数値で比較できるようにするため
- 前処理や検索ロジックの変更がどこに効いたか追えるようにするため


## 評価ノイズ分離
- `DIFY_SYNC_EXCLUDE_GLOBS` を追加し、既定で `testcases/font-ocr/**` を Dify dataset 同期対象から除外
- `POST http://docproc:8081/dify/purge-excluded` で、既に同期済みの除外対象文書を dataset から削除可能
- `evaluate_rag.py` に `--chat-only-when-retrieval-passes` と `--max-chat-cases` を追加し、retrieval 評価と chat 評価を分離可能
