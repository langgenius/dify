"""
Node Generator
Generate nodes based on workflow description
"""

from core.auto.node_types.code import CodeLanguage, CodeNodeType, OutputVar
from core.auto.node_types.common import (
    BlockEnum,
    CompleteNode,
    Context,
    InputVar,
    ModelConfig,
    PromptItem,
    PromptRole,
    ValueSelector,
    Variable,
)
from core.auto.node_types.end import EndNodeType
from core.auto.node_types.llm import LLMNodeType, VisionConfig
from core.auto.node_types.start import StartNodeType
from core.auto.node_types.template_transform import TemplateTransformNodeType
from core.auto.workflow_generator.models.workflow_description import NodeDescription
from core.auto.workflow_generator.utils.prompts import DEFAULT_MODEL_CONFIG, DEFAULT_SYSTEM_PROMPT
from core.auto.workflow_generator.utils.type_mapper import map_string_to_var_type, map_var_type_to_input_type


class NodeGenerator:
    """Node generator for creating workflow nodes"""

    @staticmethod
    def create_nodes(node_descriptions: list[NodeDescription]) -> list[CompleteNode]:
        """
        Create nodes based on node descriptions

        Args:
            node_descriptions: list of node descriptions

        Returns:
            list of nodes
        """
        nodes = []

        for node_desc in node_descriptions:
            node_type = node_desc.type

            if node_type == "start":
                node = NodeGenerator._create_start_node(node_desc)
            elif node_type == "llm":
                node = NodeGenerator._create_llm_node(node_desc)
            elif node_type == "code":
                node = NodeGenerator._create_code_node(node_desc)
            elif node_type == "template":
                node = NodeGenerator._create_template_node(node_desc)
            elif node_type == "end":
                node = NodeGenerator._create_end_node(node_desc)
            else:
                raise ValueError(f"Unsupported node type: {node_type}")

            nodes.append(node)

        return nodes

    @staticmethod
    def _create_start_node(node_desc: NodeDescription) -> CompleteNode:
        """Create start node"""
        variables = []

        for var in node_desc.variables or []:
            input_var = InputVar(
                type=map_var_type_to_input_type(var.type),
                label=var.name,
                variable=var.name,
                required=var.required,
                max_length=48,
                options=[],
            )
            variables.append(input_var)

        start_node = StartNodeType(
            title=node_desc.title, desc=node_desc.description or "", type=BlockEnum.start, variables=variables
        )

        return CompleteNode(
            id=node_desc.id,
            type="custom",
            position={"x": 0, "y": 0},  # Temporary position, will be updated later
            height=118,  # Increase height to match reference file
            width=244,
            positionAbsolute={"x": 0, "y": 0},
            selected=False,
            sourcePosition="right",
            targetPosition="left",
            data=start_node,
        )

    @staticmethod
    def _create_llm_node(node_desc: NodeDescription) -> CompleteNode:
        """Create LLM node"""
        # Build prompt template
        prompt_template = []

        # Add system prompt
        system_prompt = node_desc.system_prompt or DEFAULT_SYSTEM_PROMPT
        prompt_template.append(PromptItem(id=f"{node_desc.id}-system", role=PromptRole.system, text=system_prompt))

        # Add user prompt
        user_prompt = node_desc.user_prompt or "Please answer these questions:"

        # Build variable list
        variables = []
        for var in node_desc.variables or []:
            source_node = var.source_node or ""
            source_variable = var.source_variable or ""

            print(
                f"DEBUG: Processing variable {var.name}, source_node={source_node}, source_variable={source_variable}"
            )

            # If source node is an LLM node, ensure source_variable is 'text'
            if source_node:
                # Check if the source node is an LLM node by checking connections
                # This is a simple heuristic - if the source node is connected to a node with 'llm' in its ID
                # or if the source node has 'llm' in its ID, assume it's an LLM node
                if "llm" in source_node.lower():
                    print(f"DEBUG: Found LLM node {source_node}")
                    if source_variable != "text":
                        old_var = source_variable
                        source_variable = "text"  # LLM nodes output variable is always 'text'
                        print(
                            f"Auto-fixing: Changed source variable from '{old_var}' to 'text' for LLM node {source_node}"  # noqa: E501
                        )

            # Check if the user prompt already contains correctly formatted variable references
            # Variable references in LLM nodes should be in the format {{#nodeID.variableName#}}
            correct_format = f"{{{{#{source_node}.{source_variable}#}}}}"
            simple_format = f"{{{{{var.name}}}}}"

            # If simple format is used in the prompt, replace it with the correct format
            if simple_format in user_prompt and source_node and source_variable:
                user_prompt = user_prompt.replace(simple_format, correct_format)

            variable = Variable(variable=var.name, value_selector=[source_node, source_variable])
            variables.append(variable)

        # Update user prompt
        prompt_template.append(PromptItem(id=f"{node_desc.id}-user", role=PromptRole.user, text=user_prompt))

        # Use default model configuration, prioritize configuration in node description
        provider = node_desc.provider or DEFAULT_MODEL_CONFIG["provider"]
        model = node_desc.model or DEFAULT_MODEL_CONFIG["model"]

        llm_node = LLMNodeType(
            title=node_desc.title,
            desc=node_desc.description or "",
            type=BlockEnum.llm,
            model=ModelConfig(
                provider=provider,
                name=model,
                mode=DEFAULT_MODEL_CONFIG["mode"],
                completion_params=DEFAULT_MODEL_CONFIG["completion_params"],
            ),
            prompt_template=prompt_template,
            variables=variables,
            context=Context(enabled=False, variable_selector=ValueSelector(value=[])),
            vision=VisionConfig(enabled=False),
        )

        return CompleteNode(
            id=node_desc.id,
            type="custom",
            position={"x": 0, "y": 0},  # Temporary position, will be updated later
            height=126,  # Increase height to match reference file
            width=244,
            positionAbsolute={"x": 0, "y": 0},
            selected=False,
            sourcePosition="right",
            targetPosition="left",
            data=llm_node,
        )

    @staticmethod
    def _create_code_node(node_desc: NodeDescription) -> CompleteNode:
        """Create code node"""
        # Build variable list and function parameter names
        variables = []
        var_names = []
        var_mapping = {}  # Used to store mapping from variable names to function parameter names

        # First, identify all LLM nodes in the workflow
        llm_nodes = set()
        for connection in node_desc.workflow_description.connections:
            for node in node_desc.workflow_description.nodes:
                if node.id == connection.source and node.type.lower() == "llm":
                    llm_nodes.add(node.id)

        for var in node_desc.variables or []:
            source_node = var.source_node or ""
            source_variable = var.source_variable or ""

            # Check if source node is an LLM node and warn if source_variable is not 'text'
            if source_node in llm_nodes and source_variable != "text":
                print(
                    f"WARNING: LLM node {source_node} output variable should be 'text', but got '{source_variable}'. This may cause issues in Dify."  # noqa: E501
                )
                print("         Consider changing the source_variable to 'text' in your workflow description.")
                # Auto-fix: Always use 'text' as the source variable for LLM nodes
                old_var = source_variable
                source_variable = "text"
                print(f"Auto-fixing: Changed source variable from '{old_var}' to 'text' for LLM node {source_node}")
            elif source_node and "llm" in source_node.lower() and source_variable != "text":
                # Fallback heuristic check based on node ID
                print(
                    f"WARNING: Node {source_node} appears to be an LLM node based on its ID, but source_variable is not 'text'."  # noqa: E501
                )
                print("         Consider changing the source_variable to 'text' in your workflow description.")
                # Auto-fix: Always use 'text' as the source variable for LLM nodes
                old_var = source_variable
                source_variable = "text"
                print(f"Auto-fixing: Changed source variable from '{old_var}' to 'text' for LLM node {source_node}")

            # Use variable name as function parameter name
            variable_name = var.name  # Variable name defined in this node
            param_name = variable_name  # Function parameter name must match variable name

            # Validate variable name format
            if not variable_name.replace("_", "").isalnum():
                raise ValueError(
                    f"Invalid variable name: {variable_name}. Variable names must only contain letters, numbers, and underscores."  # noqa: E501
                )
            if not variable_name[0].isalpha() and variable_name[0] != "_":
                raise ValueError(
                    f"Invalid variable name: {variable_name}. Variable names must start with a letter or underscore."
                )

            var_names.append(param_name)
            var_mapping[variable_name] = param_name

            variable = Variable(variable=variable_name, value_selector=[source_node, source_variable])
            variables.append(variable)

        # Build output
        outputs = {}
        for output in node_desc.outputs or []:
            # Validate output variable name format
            if not output.name.replace("_", "").isalnum():
                raise ValueError(
                    f"Invalid output variable name: {output.name}. Output names must only contain letters, numbers, and underscores."  # noqa: E501
                )
            if not output.name[0].isalpha() and output.name[0] != "_":
                raise ValueError(
                    f"Invalid output variable name: {output.name}. Output names must start with a letter or underscore."
                )

            outputs[output.name] = OutputVar(type=map_string_to_var_type(output.type))

        # Generate code, ensure function parameters match variable names, return values match output names
        output_names = [output.name for output in node_desc.outputs or []]

        # Build function parameter list
        params_str = ", ".join(var_names) if var_names else ""

        # Build return value dictionary
        return_dict = {}
        for output_name in output_names:
            # Use the first variable as the return value by default
            return_dict[output_name] = var_names[0] if var_names else f'"{output_name}"'

        return_dict_str = ", ".join([f'"{k}": {v}' for k, v in return_dict.items()])

        # Default code template, ensure return dictionary type matches output variable
        default_code = f"""def main({params_str}):
    # Write your code here
    # Process input variables
    
    # Return a dictionary, key names must match variable names defined in outputs
    return {{{return_dict_str}}}"""

        # If custom code is provided, ensure it meets the specifications
        if node_desc.code:
            custom_code = node_desc.code
            # Check if it contains main function definition
            if not custom_code.strip().startswith("def main("):
                # Try to fix the code by adding main function with correct parameters
                custom_code = f"def main({params_str}):\n" + custom_code.strip()
            else:
                # Extract function parameters from the existing main function
                import re

                func_params = re.search(r"def\s+main\s*\((.*?)\)", custom_code)
                if func_params:
                    existing_params = [p.strip() for p in func_params.group(1).split(",") if p.strip()]
                    # Verify that all required parameters are present
                    missing_params = set(var_names) - set(existing_params)
                    if missing_params:
                        # 尝试修复代码，将函数参数替换为正确的参数名
                        old_params = func_params.group(1)
                        new_params = params_str
                        custom_code = custom_code.replace(f"def main({old_params})", f"def main({new_params})")
                        print(
                            f"Warning: Fixed missing parameters in code node: {', '.join(missing_params)}. Function parameters must match variable names defined in this node."  # noqa: E501
                        )

            # Check if the return value is a dictionary and keys match output variables
            for output_name in output_names:
                if f'"{output_name}"' not in custom_code and f"'{output_name}'" not in custom_code:
                    # Code may not meet specifications, use default code
                    custom_code = default_code
                    break

            # Use fixed code
            code = custom_code
        else:
            code = default_code

        code_node = CodeNodeType(
            title=node_desc.title,
            desc=node_desc.description or "",
            type=BlockEnum.code,
            code_language=CodeLanguage.python3,
            code=code,
            variables=variables,
            outputs=outputs,
        )

        return CompleteNode(
            id=node_desc.id,
            type="custom",
            position={"x": 0, "y": 0},  # Temporary position, will be updated later
            height=82,  # Increase height to match reference file
            width=244,
            positionAbsolute={"x": 0, "y": 0},
            selected=False,
            sourcePosition="right",
            targetPosition="left",
            data=code_node,
        )

    @staticmethod
    def _create_template_node(node_desc: NodeDescription) -> CompleteNode:
        """Create template node"""
        # Build variable list
        variables = []
        template_text = node_desc.template or ""

        # Collect all node IDs referenced in the template
        referenced_nodes = set()
        for var in node_desc.variables or []:
            source_node = var.source_node or ""
            source_variable = var.source_variable or ""

            variable = Variable(variable=var.name, value_selector=[source_node, source_variable])
            variables.append(variable)

            if source_node:
                referenced_nodes.add(source_node)

            # Modify variable reference format in the template
            # Replace {{#node_id.variable#}} with {{ variable }}
            if source_node and source_variable:
                template_text = template_text.replace(f"{{{{#{source_node}.{source_variable}#}}}}", f"{{ {var.name} }}")

        # Check if a reference to the start node needs to be added
        # If the template contains a reference to the start node but the variable list does not have a corresponding variable  # noqa: E501
        import re

        start_node_refs = re.findall(r"{{#(\d+)\.([^#]+)#}}", template_text)

        for node_id, var_name in start_node_refs:
            # Check if there is already a reference to this variable
            if not any(v.variable == var_name for v in variables):
                # Add reference to start node variable
                variable = Variable(variable=var_name, value_selector=[node_id, var_name])
                variables.append(variable)

                # Modify variable reference format in the template
                template_text = template_text.replace(f"{{{{#{node_id}.{var_name}#}}}}", f"{{ {var_name} }}")

        # Get all variable names
        var_names = [var.variable for var in variables]

        # Simple and crude method: directly replace all possible variable reference formats
        for var_name in var_names:
            # Replace {var_name} with {{ var_name }}
            template_text = template_text.replace("{" + var_name + "}", "{{ " + var_name + " }}")
            # Replace { var_name } with {{ var_name }}
            template_text = template_text.replace("{ " + var_name + " }", "{{ " + var_name + " }}")
            # Replace {var_name } with {{ var_name }}
            template_text = template_text.replace("{" + var_name + " }", "{{ " + var_name + " }}")
            # Replace { var_name} with {{ var_name }}
            template_text = template_text.replace("{ " + var_name + "}", "{{ " + var_name + " }}")
            # Replace {{{ var_name }}} with {{ var_name }}
            template_text = template_text.replace("{{{ " + var_name + " }}}", "{{ " + var_name + " }}")
            # Replace {{{var_name}}} with {{ var_name }}
            template_text = template_text.replace("{{{" + var_name + "}}}", "{{ " + var_name + " }}")

        # Use regular expression to replace all triple curly braces with double curly braces
        template_text = re.sub(r"{{{([^}]+)}}}", r"{{ \1 }}", template_text)

        template_node = TemplateTransformNodeType(
            title=node_desc.title,
            desc=node_desc.description or "",
            type=BlockEnum.template_transform,
            template=template_text,
            variables=variables,
        )

        return CompleteNode(
            id=node_desc.id,
            type="custom",
            position={"x": 0, "y": 0},  # Temporary position, will be updated later
            height=82,  # Increase height to match reference file
            width=244,
            positionAbsolute={"x": 0, "y": 0},
            selected=False,
            sourcePosition="right",
            targetPosition="left",
            data=template_node,
        )

    @staticmethod
    def _create_end_node(node_desc: NodeDescription) -> CompleteNode:
        """Create end node"""
        # Build output variable list
        outputs = []
        for output in node_desc.outputs or []:
            variable = Variable(
                variable=output.name, value_selector=[output.source_node or "", output.source_variable or ""]
            )
            outputs.append(variable)

        end_node = EndNodeType(
            title=node_desc.title, desc=node_desc.description or "", type=BlockEnum.end, outputs=outputs
        )

        return CompleteNode(
            id=node_desc.id,
            type="custom",
            position={"x": 0, "y": 0},  # Temporary position, will be updated later
            height=90,
            width=244,
            positionAbsolute={"x": 0, "y": 0},
            selected=False,
            sourcePosition="right",
            targetPosition="left",
            data=end_node,
        )
