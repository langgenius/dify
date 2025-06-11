import yaml
from pathlib import Path

def get_init_knowledge_config(config:dict) -> dict :
    return get_ext_config(file_name="dataset_config.yml", config=config)

def get_init_full_text_knowledge_config(config:dict) -> dict :
    return get_ext_config(file_name="full_text_dataset_config.yml", config=config)

def get_ext_config(file_name:str, config:dict = None,params : dict = None) -> dict :
    # 获取当前脚本所在的目录
    current_dir = Path(__file__).resolve().parent
    # 构造绝对路径
    config_path = current_dir / "ext" / file_name
    # 读取 YAML 文件
    with open(config_path, "r") as f:
        config_data = yaml.safe_load(f)  # 使用 safe_load 避免执行任意代码
    config_data = replace_placeholders(data = config_data, params = params)
    if config is not None:
        config_data={**config_data,**config}

    return config_data

# 定义一个函数，用于替换 YAML 中的占位符
def replace_placeholders(data, params:dict = None) -> dict:
    if params is not None:
        if isinstance(data, dict):
            # 如果是字典，递归处理每个键值对
            return {k: replace_placeholders(v, params) for k, v in data.items()}
        elif isinstance(data, list):
            # 如果是列表，递归处理每个元素
            return [replace_placeholders(item, params) for item in data]
        elif isinstance(data, str):
            # 如果是字符串，尝试替换占位符
            for key, value in params.items():
                placeholder = f"${{{key}}}"  # 构造占位符格式，例如 ${DB_HOST}
                data = data.replace(placeholder, value)
            return data

    # 其他类型直接返回
    return data
