import yaml
import warnings
from pdf_extract_kit.registry.registry import TASK_REGISTRY, MODEL_REGISTRY


def load_config(config_path):
    if config_path is None:
        warnings.warn(
            ("Configuration path is None. Please provide a valid configuration file path. ")
        )
        return None
    
    with open(config_path, 'r') as file:
        config = yaml.safe_load(file)
    return config


# def initialize_task_and_model(config):
#     task_name = config['task']
#     model_name = config['model']
#     model_config = config['model_config']

#     TaskClass = TASK_REGISTRY.get(task_name)
#     ModelClass = MODEL_REGISTRY.get(model_name)

#     model_instance = ModelClass(model_config)
#     task_instance = TaskClass(model_instance)

#     return task_instance

def initialize_tasks_and_models(config):

    task_instances = {}
    for task_name in config['tasks']:

        model_name = config['tasks'][task_name]['model']
        model_config = config['tasks'][task_name]['model_config']

        TaskClass = TASK_REGISTRY.get(task_name)
        ModelClass = MODEL_REGISTRY.get(model_name)

        model_instance = ModelClass(model_config)
        task_instance = TaskClass(model_instance)

        task_instances[task_name] = task_instance

    return task_instances