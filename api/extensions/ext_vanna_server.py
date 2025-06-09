import json
import ast
from configs import dify_config
from extensions.utils.vanna_text2sql import VannaServer
from dotenv import load_dotenv
load_dotenv()
from dify_app import DifyApp
from flask import Flask, jsonify, Response, request
import flask
from werkzeug.exceptions import BadRequest
import logging
import plotly.io as pio
from functools import lru_cache
from datetime import datetime
class Config:
    def __init__(self, supplier):
        self.embedding_supplier = "SiliconFlow"
        self.milvus_uri = dify_config.MILVUS_URI
        self.milvus_database = 'vanna_demo'
        self.supplier = supplier
        # self.llm_type = 'tongyi'
        # self.model = 'qwen-max'
        # self.api_key = 'sk-ba5d240e2dc0483e9e24404d957a15d5'
        # 本地模型
        # self.ollama_host = 'http://wsd.wisdomidata.com:19042'
        # self.model = 'qwen2:7b'
        self.llm_type = 'deepseek'
        self.model = 'deepseek-coder'
        self.api_key = 'sk-0382990b7a90496c889774b1d3843f90'
        self.sql_type = 'postgres'
        self.sql_config = {
            "host": dify_config.DB_HOST,
            "dbname": 'vanna_demo',
            "user": dify_config.DB_USERNAME,
            "password": dify_config.DB_PASSWORD,
            "port": dify_config.DB_PORT
        }

# 存储不同的 VannaServer 实例
vn_instances = {}
# 获取vanna实例
def get_vn_instance(supplier=""):
    """获取或创建VannaServer实例"""
    if supplier == "":
        supplier = "default"
    if supplier not in vn_instances:
        config = Config(supplier)
        # 合并配置
        combined_config = {**config.__dict__, **config.sql_config}
        vn_instances[supplier] = VannaServer(combined_config)
    return vn_instances[supplier]

def init_app(app: DifyApp):
    @app.route('/api/ask', methods=['POST'])
    def ask_route():
        """提问接口"""
        data = request.json
        question = data.get('question', '')
        visualize = data.get('visualize', True)
        auto_train = data.get('auto_train', False)
        supplier = data.get('supplier', "")  # GITEE, ZHIPU, SiliconFlow

        if not question:
            raise BadRequest("Question is required")

        server = get_vn_instance(supplier)
        try:
            sql, df, fig = server.ask(question=question, visualize=visualize, auto_train=auto_train)

            df_json = df.to_json(orient='records', force_ascii=False)

            """
            <img id="plotly-image" src="data:image/png;base64,{{ img_base64 }}" alt="Plotly Image">
            """

            # fig_js_path = '../output/html/vanna_fig.js'
            # fig_html_path = 'http://localhost:8000/html/vanna_fig.html'
            # figure_json = pio.to_json(fig)
            # with open(fig_js_path, 'w', encoding='utf-8') as f:
            #     f.write(figure_json)
            """
              <div id="plotly-div"></div>
              <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
              <script>
                  var fig_json = {{ fig_json }};
                  Plotly.newPlot('plotly-div', fig_json.data, fig_json.layout);
              </script>
            """

            logging.info("Query processed successfully")
            return jsonify({
                'sql': sql,
                'data': df_json,
                # 'img_base64': img_base64,
                # 'plotly_figure': fig_html_path
            }), 200
        except Exception as e:
            logging.error(f"Error processing request: {e}")
            return jsonify({'error': str(e)}), 500

    @app.route('/api/vn_train', methods=['POST'])
    def vn_train_route():
        """训练接口"""
        data = request.json
        # required_fields = ['question', 'sql']
        # validate_input(data, required_fields)

        supplier = data.get('supplier', "")
        question = data.get('question', '')
        sql = data.get('sql', '')
        documentation = data.get('documentation', '')
        ddl = data.get('ddl', '')
        schema = data.get('schema', False)

        # 验证至少有一个参数不为空
        if not any([question, sql, documentation, ddl, schema]):
            return jsonify(
                {
                    'error': 'At least one of the parameters (question, sql, documentation, ddl, schema) must be provided'}), 400

        server = get_vn_instance(supplier)
        server.vn_train(question=question, sql=sql, documentation=documentation, ddl=ddl)
        if schema:
            try:
                # server.schema_train()
                # 更新建表DDL语句
                server.refresh_create_table_ddl_train()
                server.refresh_schema_train()
            except Exception as e:
                logging.info(f"Error initializing vector store: {e}")

        logging.info("Training completed successfully")
        return jsonify({'status': 'success'}), 200


    @app.route('/api/docs/update', methods=['POST'])
    def update_schema_train_list_route():
        """训练接口"""
        data = request.json
        docs = data.get('docs', [])
        server = get_vn_instance("")
        server.update_schema_train_list(docs=docs)
        return jsonify({'status': 'success'}), 200

    @app.route('/api/get_training_data', methods=['GET'])
    def get_training_data_route():
        """获取训练数据接口"""
        supplier = request.args.get('supplier', "")
        server = get_vn_instance(supplier)

        @lru_cache(maxsize=128)  # 添加缓存机制
        def cached_get_training_data():
            return server.get_training_data()

        training_data = cached_get_training_data()
        logging.info("Fetched training data successfully")

        return jsonify({
            'data': json.loads(training_data.to_json(orient='records'))
        }), 200

    @app.route('/api/generate_sql', methods=['GET'])
    def generate_sql():
        question = request.args.get('question')
        supplier = request.args.get('supplier','')

        if question is None:
            return jsonify({"type": "error", "error": "No question provided"})
        server = get_vn_instance(supplier)
        sql = server.generate_sql(question=question)
        return jsonify(
            {
                "sql": sql
            }) , 200

    @app.route('/api/run_sql', methods=['POST'])
    def run_sql():
        data = request.json
        supplier = data.get('supplier', "")
        sql = data.get('sql', '')
        try:
            server = get_vn_instance(supplier)
            df = server.run_sql(sql=sql)
            df_json = df.to_json(orient='records', force_ascii=False)
            return df_json, 200

        except Exception as e:
            return jsonify({"type": "error", "error": str(e)})

    @app.route('/api/training/data/export', methods=['GET'])
    def training_data_export():
        supplier = request.args.get('supplier', "")

        server = get_vn_instance(supplier)

        # @lru_cache(maxsize=128)  # 添加缓存机制
        # def cached_get_training_data():
        #     return server.training_data_export()
        # training_data = cached_get_training_data()

        data = server.training_data_export()
        content = ",\n".join(str(line) for line in data)

        file_name = datetime.now().strftime('%Y-%m-%d-%H-%M')

        # 创建一个可下载的文本响应
        return Response(
            f"[\n{content}\n]",
            mimetype='text/plain',
            headers={
                "Content-Disposition": f"attachment; filename={file_name}.txt"
            }
        )

    @app.route('/api/training/data/import', methods=['POST'])
    def training_data_import():
       
        if 'file' not in request.files:
                return jsonify({"type": "error", "error": "未上传文件"}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({"type": "error", "error": "文件名为空"}), 400

        try:
            # 读取文件并解析每一行的 JSON 对象
            content = file.read().decode('utf-8').strip()
            data_list = ast.literal_eval(content)

            server = get_vn_instance("")
            result = server.training_data_import(data_list)
            if result:
                return jsonify({"type": "error", "error": "存在数据集question 或 sql为空"})

            return jsonify({'status': 'success'}), 200

        except Exception as e:
            return jsonify({"type": "error", "error": f"文件解析失败: {str(e)}"}), 500