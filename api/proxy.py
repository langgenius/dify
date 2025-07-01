import logging

from flask import Flask, request

app = Flask(__name__)

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.route('/hello', methods=['GET', 'POST'])
def hello():
    # 获取所有请求参数（包括GET和POST）
    params = request.args.to_dict()
    if request.method == 'POST':
        params.update(request.form.to_dict())
        # 也可以处理JSON body
        if request.is_json:
            params.update(request.get_json() or {})
    logger.info(f"Request params: {params}")
    return {'message': 'Hello, world!', 'params': params}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5010)
