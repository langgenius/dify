import os
import json
from vanna.ollama import Ollama
from vanna.qianwen import QianWenAI_Chat
from vanna.deepseek import DeepSeekChat
from extensions.utils.rewrite_ask import ask
from dotenv import load_dotenv
import plotly.io as pio
from vanna.milvus import Milvus_VectorStore
from pymilvus import MilvusClient,model
from collections import defaultdict


load_dotenv()
# 设置显示后端为浏览器
pio.renderers.default = 'browser'
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

from typing import List
import ollama
import numpy as np
from pymilvus.model.base import BaseEmbeddingFunction
# 自定义嵌入式模型（适配milvus向量数据库）
class CustomEmbeddingFunction(BaseEmbeddingFunction):
    def __init__(self, config=None):
        model_host = config['host'] if "host" in config else 'http://wsd.wisdomidata.com:19042'
        self.embed_model = config['embed_model'] if "embed_model" in config else 'bge-m3'
        self.embedding_model = ollama.Client(model_host)
        self.keep_alive = config.get('keep_alive', None)
        self.ollama_options = config.get('options', {})
        self.num_ctx = self.ollama_options.get('num_ctx', 2048)

    def __call__(self, texts: List[str]):
        self._encode(texts)
    def _encode(self,texts: list[str]) -> list[list[float]]:
        return [self.embedding_model.embeddings(
            model=self.embed_model,
            prompt=text,
            options=self.ollama_options,
            keep_alive=self.keep_alive
        )["embedding"] for text in texts]
    def encode_documents(self, documents: List[str]) -> List[np.array]:
        # 将每个嵌入结果转换为 np.ndarray
        embeddings = self._encode(documents)
        return [np.array(embedding) for embedding in embeddings]
    def encode_queries(self, queries: List[str]) -> List[np.array]:
        embeddings = self._encode(queries)
        return [np.array(embedding) for embedding in embeddings]

class VannaServer:
    def __init__(self, config):
        self.config = config
        self.vn = self._initialize_vn()

    def _initialize_vn(self):
        config = self.config
        supplier = config["supplier"]
        llm_type = config["llm_type"]
        model_ = config["model"]
        api_key = config["api_key"]
        ollama_host = config["ollama_host"] if "ollama_host" in config else None
        milvus_uri = config["milvus_uri"]
        sql_type = config["sql_type"]
        host = config["host"] if "host" in config else os.getenv("DB_HOST", "localhost")
        dbname = config["dbname"] if "dbname" in config else os.getenv("DB_NAME", "dify_data")
        user = config["user"] if "user" in config else os.getenv("DB_USER", "root")
        password = config["password"] if "password" in config else os.getenv("DB_PASSWORD", "mysql")
        port = config["port"] if "port" in config else int(os.getenv("DB_PORT", 3306))
        milvus_database = config["milvus_database"] if "milvus_database" in config else "test"
        milvus_client = MilvusClient(uri=milvus_uri,db_name=milvus_database)

        embedding_host = config["embedding_host"] if "embedding_host" in config else 'http://wsd.wisdomidata.com:19042'
        embedding_model = config["embedding_model"] if "embedding_model" in config else "bge-m3" # BAAI/bge-m3
        embedding_function = model.dense.SentenceTransformerEmbeddingFunction(
            model_name=embedding_model,
            device='cpu'  # 'cpu' or 'cuda:0'
        )
        # embedding_function = CustomEmbeddingFunction({
        #     "host": embedding_host,
        #     "embed_model": embedding_model
        # })
        chat_llm = Ollama
        if llm_type == "ollama":
            config = {
                'model': model_,  # 本地ollama大模型名称
                'ollama_host': ollama_host,  # 本地ollama大模型服务地址
                'milvus_client': milvus_client,  # 本地milvus向量数据库服务地址
                "n_results": 12,
                "embedding_function": embedding_function,
            }
        else:
            config = {
                'model': model_,  # 本地ollama大模型名称
                'api_key': api_key,  # 本地ollama大模型服务地址
                'milvus_client': milvus_client,  # 本地milvus向量数据库服务地址
                "n_results": 12,
                "embedding_function": embedding_function,
            }
        if llm_type == "tongyi":
            chat_llm = QianWenAI_Chat
        elif llm_type == "deepseek":
            chat_llm = DeepSeekChat

        MyVanna = make_vanna_class(ChatClass=chat_llm)
        vn = MyVanna(config)
        if sql_type == "postgres":
            vn.connect_to_postgres(host=host, dbname=dbname, user=user, password=password, port=port)
        elif sql_type == "mysql":
            vn.connect_to_mysql(host=host, dbname=dbname, user=user, password=password, port=port)

        return vn

    def schema_train(self):
        # The information schema query may need some tweaking depending on your database. This is a good starting point.
        df_information_schema = self.vn.run_sql("SELECT * FROM INFORMATION_SCHEMA.COLUMNS where table_schema = 'public'")

        # This will break up the information schema into bite-sized chunks that can be referenced by the LLM
        plan = self.vn.get_training_plan_generic(df_information_schema)
        # print(plan)

        # If you like the plan, then uncomment this and run it to train
        self.vn.train(plan=plan)

    # 更新建表DDL语句
    def refresh_create_table_ddl_train(self):
        sql = """
SELECT
    'CREATE TABLE '
    || C.TABLE_NAME
    || ' ('
    || C.COLUMN_NAMES
    || ');'
    || C.COMMENT_COLUMNS
		|| CASE WHEN FK.FOREIGN_KEY_COLUMNS IS NOT NULL THEN FK.FOREIGN_KEY_COLUMNS ELSE '' END
		|| CASE WHEN FK.FOREIGN_KEY_DESC IS NOT NULL THEN FK.FOREIGN_KEY_DESC ELSE '' END
    || 'COMMENT ON TABLE '
    || C.TABLE_NAME
    || ' IS '''
    || G.DESCRIPTION
    || ''';'
		AS DDL,
    C.TABLE_NAME
FROM (
    SELECT
        COL.TABLE_NAME,
        COL.TABLE_SCHEMA,
        STRING_AGG(
            COL.COLUMN_NAME
            || ' '
            || COL.DATA_TYPE
            || COALESCE('(' || COL.CHARACTER_MAXIMUM_LENGTH || ')', '')
            || COALESCE(' DEFAULT ' || COL.COLUMN_DEFAULT, '')
            || CASE
                WHEN COL.IS_NULLABLE = 'NO' THEN ' NOT NULL'
                ELSE ''
              END,
            ','
        ) AS COLUMN_NAMES,
        STRING_AGG(
            'COMMENT ON COLUMN '
            || COL.TABLE_NAME
            || '.'
            || COL.COLUMN_NAME
            || ' IS '''
            || PGD.DESCRIPTION
            || ''';',
            ''
        ) AS COMMENT_COLUMNS
    FROM
        PG_CATALOG.PG_STATIO_ALL_TABLES AS ST
    INNER JOIN
        PG_CATALOG.PG_DESCRIPTION AS PGD
        ON PGD.OBJOID = ST.RELID
    INNER JOIN
        INFORMATION_SCHEMA.COLUMNS AS COL
        ON (
            COL.TABLE_SCHEMA = ST.SCHEMANAME
            AND COL.TABLE_NAME = ST.RELNAME
            AND COL.ORDINAL_POSITION = PGD.OBJSUBID
        )
    WHERE
        COL.TABLE_SCHEMA = 'public'
    GROUP BY
        COL.TABLE_SCHEMA,
        COL.TABLE_NAME
) C
LEFT JOIN (
    SELECT
        N.NSPNAME AS SCHEMA_NAME,
        C.RELNAME AS TABLE_NAME,
        D.DESCRIPTION
    FROM
        PG_CATALOG.PG_DESCRIPTION D
    JOIN
        PG_CATALOG.PG_CLASS C
        ON C.OID = D.OBJOID
    JOIN
        PG_CATALOG.PG_NAMESPACE N
        ON N.OID = C.RELNAMESPACE
    WHERE
        C.RELKIND = 'r'
        AND D.OBJSUBID = 0
) G
ON G.SCHEMA_NAME = C.TABLE_SCHEMA
AND G.TABLE_NAME = C.TABLE_NAME
LEFT JOIN (
    SELECT rel_src.relname AS source_table,
        STRING_AGG(
            'ALTER TABLE '
            || rel_src.relname
            || ' ADD CONSTRAINT '
            || con.conname
            || ' FOREIGN KEY ('
            || att_src.attname
            || ') REFERENCES '
            || rel_tgt.relname
            || '('
            || att_tgt.attname
            || ');'
            ,
            ''
      ) AS FOREIGN_KEY_COLUMNS,
        STRING_AGG(
                'COMMENT ON CONSTRAINT  '
                || con.conname
                || ' ON '
                || rel_src.relname
                || ' IS '''
                || d.description
                || ''';',
                ''
        ) AS FOREIGN_KEY_DESC
    FROM
        pg_constraint con
        JOIN pg_class rel_src ON rel_src.oid = con.conrelid
        JOIN pg_class rel_tgt ON rel_tgt.oid = con.confrelid
        JOIN pg_attribute att_src ON att_src.attrelid = rel_src.oid AND att_src.attnum = ANY(con.conkey)
        JOIN pg_attribute att_tgt ON att_tgt.attrelid = rel_tgt.oid AND att_tgt.attnum = ANY(con.confkey)
        LEFT JOIN pg_description d ON d.objoid = con.oid
    WHERE
        con.contype = 'f'
    GROUP BY
        rel_src.relname
) FK ON FK.source_table = C.TABLE_NAME
WHERE C.TABLE_NAME NOT IN ('flyway_table_dict','flyway_schema_history')
"""
        # The information schema query may need some tweaking depending on your database. This is a good starting point.
        c_table_ddl_list = self.vn.run_sql(sql)

        # 将 DataFrame 转换为字典列表
        c_table_ddl_records = c_table_ddl_list.to_dict(orient='records')

        exist_ddl_data = self.vn.milvus_client.query(
            collection_name="vannaddl",
            output_fields=["*"],
            limit=10000,
        )
        exists_list = filter(lambda m: m["ddl"].startswith("CREATE TABLE "), exist_ddl_data)
        remove_ids = [exist["id"] for exist in exists_list]
        if len(remove_ids) > 0:
            self.vn.milvus_client.delete(collection_name="vannaddl", ids=remove_ids)

        for table_ddl in c_table_ddl_records:
            self.vn.train(ddl=table_ddl["ddl"])

        self.vn.milvus_client.refresh_load(collection_name="vannaddl")


    def refresh_schema_train(self):
        exist_doc_data = self.vn.milvus_client.query(
            collection_name="vannadoc",
            output_fields=["*"],
            limit=10000,
        )
        exists_list = filter(lambda m: m["doc"].startswith("The following columns are in the "), exist_doc_data)
        remove_ids = [exist["id"] for exist in exists_list]
        if len(remove_ids) > 0:
            self.vn.milvus_client.delete(collection_name="vannadoc", ids=remove_ids)
        self.schema_train()
        self.vn.milvus_client.refresh_load(collection_name="vannadoc")

    def update_schema_train_list(self,docs : list[str]):
        exist_doc_data = self.vn.milvus_client.query(
            collection_name="vannadoc",
            output_fields=["*"],
            limit=10000,
        )
        exists_list = filter(lambda m: not m["doc"].startswith("The following columns are in the "), exist_doc_data)
        remove_ids = [exist["id"] for exist in exists_list]
        if len(remove_ids) > 0:
            self.vn.milvus_client.delete(collection_name="vannadoc", ids=remove_ids)
        dict_docs = self.get_dict_docs()
        docs.extend(dict_docs)

        for doc in docs:
            self.vn.train(documentation=doc)
        # self.schema_train()
        self.vn.milvus_client.refresh_load(collection_name="vannadoc")

    def get_dict_docs(self) -> list[str]:
        dict_docs = []
        sql = "select id,table_name,column_name,column_remark,table_remark,dict_values from flyway_table_dict"
        c_table_dict_list = self.vn.run_sql(sql)
        # 将 DataFrame 转换为字典列表
        c_table_dict_records = c_table_dict_list.to_dict(orient='records')

        table_names = list(set(item['table_name'] for item in c_table_dict_records))

        grouped = defaultdict(list)
        for table_dict in c_table_dict_records:
            table_name = table_dict['table_name']  # 分组依据字段
            grouped[table_name].append(table_dict)

        grouped_dict = dict(grouped)

        for table_name in table_names:
            columns_list = grouped_dict[table_name]
            dict_values = ';'.join(f"字段:{item['column_remark']}({item['column_name']})的值:{item["dict_values"]}" for item in columns_list)
            column = columns_list[0]
            doc = f"{column["table_remark"]}表:{column["table_name"]},{dict_values}"
            dict_docs.append(doc)
        return dict_docs

    def vn_train(self, question="", sql="", documentation="", ddl=""):
        if question and sql:
            # 训练问答对
            self.vn.train(
                question=question,
                sql=sql
            )
        elif sql:
            # You can also add SQL queries to your training data. This is useful if you have some queries already laying around. You can just copy and paste those from your editor to begin generating new SQL.
            self.vn.train(sql=sql)

        if documentation:
            # Sometimes you may want to add documentation about your business terminology or definitions.
            self.vn.train(documentation=documentation)

        if ddl:
            # You can also add DDL queries to your training data. This is useful if you have some queries already laying around. You can just copy and paste those from your editor to begin generating new SQL.
            self.vn.train(ddl=ddl)

    def get_training_data(self):
        training_data = self.vn.get_training_data()
        # print(training_data)
        return training_data

    def ask(self, question, visualize=True, auto_train=True, *args, **kwargs):
        sql, df, fig = ask(self.vn, question, visualize=visualize, auto_train=auto_train, *args, **kwargs)
        return sql, df, fig

    def generate_sql(self, question):
        return self.vn.generate_sql(question=question)

    def run_sql(self, sql):
        return self.vn.run_sql(sql=sql)

    def training_data_export(self):
        training_data = self.vn.milvus_client.query(
            collection_name="vannasql",
            output_fields=["*"],
            limit=10000,
        )
        result = []
        if training_data is not None:
            result = [{"question":t['text'], "sql": t['sql']} for t in training_data]

        return result

    def training_data_import(self, data_list):

        empty_items = list(filter(
            lambda item: item['question'] is None or item['question'] == "" or item['sql'] is None or item['sql'] == "",
            data_list
        ))

        if bool(empty_items):
            return True

        exist_doc_data = self.vn.milvus_client.query(
            collection_name="vannasql",
            output_fields=["*"],
            limit=10000,
        )
        data_texts = {t["question"]: t for t in data_list}

        if bool(exist_doc_data):
           remove_ids = [item["id"] for item in exist_doc_data if item['text'] in data_texts ]

           if bool(remove_ids):
               self.vn.milvus_client.delete(collection_name="vannasql", ids=remove_ids)

        for item in data_list:
            self.vn.train(
                question=item["question"],
                sql=item["sql"],
            )

        self.vn.milvus_client.refresh_load(collection_name="vannasql")

        return False

def make_vanna_class(ChatClass=Ollama):
    class MyVanna(Milvus_VectorStore, ChatClass):
        def __init__(self, config=None):
            Milvus_VectorStore.__init__(self, config=config)
            ChatClass.__init__(self, config=config)

        def is_sql_valid(self, sql: str) -> bool:
            # Your implementation here
            return False

        def generate_query_explanation(self, sql: str):
            my_prompt = [
                self.system_message("You are a helpful assistant that will explain a SQL query"),
                self.user_message("Explain this SQL query: " + sql),
            ]

            return self.submit_prompt(prompt=my_prompt)

    return MyVanna


# 使用示例
if __name__ == '__main__':
    config = {"supplier": "GITEE"}
    server = VannaServer(config)
    # server.schema_train()
    server.ask("汇总每个类别的销售量和销售额, 并按照销售量进行降序排列")
