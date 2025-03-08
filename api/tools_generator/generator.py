import json
from pathlib import Path

import json
from pathlib import Path
from typing import List, Dict

from templates import YAML_TEMPLATE, PARAM_TEMPLATE, PYTHON_TEMPLATE

class ToolGenerator:
    def __init__(self, config_path: str):
        self.config = self.load_config(config_path)
    
    def load_config(self, path: str) -> List[Dict]:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def generate_all(self, output_path: str):
        base_path = Path(output_path)
        for tool in self.config:
            self._generate_tool(tool, base_path)
    
    def _generate_tool(self, tool: Dict, base_path: Path):
        tool_dir = base_path
        tool_dir.mkdir(parents=True, exist_ok=True)
        
        yaml_content = self._build_yaml(tool)
        with open(tool_dir / f"{tool['metric_name']}.yaml", 'w', encoding='utf-8') as f:
            f.write(yaml_content)
        
        python_content = self._build_python(tool)
        with open(tool_dir / f"{tool['metric_name']}.py", 'w', encoding='utf-8') as f:
            f.write(python_content)
    
    def _build_yaml(self, tool: Dict) -> str:
        params_block = "\n".join(
            PARAM_TEMPLATE.format(
                name=param["name"],
                type=param["type"],
                required=param["required"],
                label_en=param["describe_en"],
                label_zh=param["describe"],
                desc_en=param["describe_en"],
                desc_zh=param["describe"],
                llm_desc=param["describe_en"],
                form="llm"
            ) for param in tool["params"]
        )
        
        return YAML_TEMPLATE.format(
            tool_id=tool["describe"],
            en_label=tool["describe_en"],
            zh_label=tool["describe"],
            en_desc=tool["describe_en"],
            zh_desc=tool["describe"],
            llm_desc=tool["describe_en"],
            disp_type="metric",
            disp_title=tool["title"],
            disp_unit=tool["unit"],
            params_block=params_block
        )
    
    def _build_python(self, tool: Dict) -> str:
        param_lines = "\n".join(
            f"        {param['name']} = tool_parameters.get('{param['name']}')"
            for param in tool["params"]
        )
        
        param_dict = []
        for param in tool["params"]:
            name = param.get("name", "").strip()
            if not name:
                continue
            
            if param.get("required", False):
                param_dict.append(f"                '{name}': {name}")
            else:
                param_dict.append(f"                **({{'{name}': {name}}} if {name} else {{}})")

        params_content = ",\n".join(param_dict)
        
        return PYTHON_TEMPLATE.format(
            class_name=self._generate_class_name(tool["metric_name"]),
            param_lines=param_lines,
            param_dict=params_content,
            metric_name=tool["title"]
        )
    
    def _generate_class_name(self, metric_name: str) -> str:
        cleaned = ''.join(c for c in metric_name.title() if c.isalnum())
        return f"{cleaned}Tool"
