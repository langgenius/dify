"""
Prompt Template Collection
Contains all prompt templates used for generating workflows
"""

# Default model configuration
DEFAULT_MODEL_CONFIG = {
    "provider": "zhipuai",
    "model": "glm-4-flash",
    "mode": "chat",
    "completion_params": {"temperature": 0.7},
}


# Default system prompt
DEFAULT_SYSTEM_PROMPT = "You are a workflow design expert who can design Dify workflows based on user requirements."


# Code node template
CODE_NODE_TEMPLATE = """def main(input_var):
    # Process input variable
    result = input_var

    # Return a dictionary; keys must exactly match variable names defined in outputs
    return {"output_var_name": result}"""


def build_workflow_prompt(user_requirement: str) -> str:
    """
    Build workflow generation prompt

    Args:
        user_requirement: User requirement description

    Returns:
        Prompt string
    """
    # String concatenation to avoid brace escaping
    prompt_part1 = (
        """
    Please design a Dify workflow based on the following user requirement:

    User requirement: """
        + user_requirement
        + """

    The description's language should align consistently with the user's requirements.
    
    Generate a concise workflow description containing the following node types:
    - Start: Start node, defines workflow input parameters
    - LLM: Large Language Model node for text generation
    - Code: Code node to execute Python code
    - Template: Template node for formatting outputs
    - End: End node, defines workflow output

    【Important Guidelines】:
    1. When referencing variables in LLM nodes, use the format {{#nodeID.variable_name#}}, e.g., {{#1740019130520.user_question#}}, where 1740019130520 is the source node ID. Otherwise, in most cases, the user prompt should define a template to guide the LLM’s response.
    2. Code nodes must define a `main` function that directly receives variables from upstream nodes as parameters; do not use template syntax inside the function.
    3. Dictionary keys returned by Code nodes must exactly match the variable names defined in outputs.
    4. Variables in Template nodes must strictly use double curly braces format "{{ variable_name }}"; note exactly two curly braces, neither one nor three. For example, "User question is: {{ user_question }}, answer: {{ answer }}". Triple curly braces such as "{{{ variable_name }}}" are strictly forbidden.
    5. IMPORTANT: In Code nodes, the function parameter names MUST EXACTLY MATCH the variable names defined in that Code node. For example, if a Code node defines a variable with name "input_text" that receives data from an upstream node, the function parameter must also be named "input_text" (e.g., def main(input_text): ...).
    6. CRITICAL: LLM nodes ALWAYS output their result in a variable named "text". When a Code node receives data from an LLM node, the source_variable MUST be "text". For example, if a Code node has a variable named "llm_output" that receives data from an LLM node, the source_variable should be "text", not "input_text" or any other name.

    Return the workflow description in JSON format as follows:
    ```json
    {
        "name": "Workflow Name",
        "description": "Workflow description",
        "nodes": [
            {
                "id": "node1",
                "type": "start",
                "title": "Start Node",
                "description": "Description of the start node",
                "variables": [
                    {
                        "name": "variable_name",
                        "type": "string|number",
                        "description": "Variable description",
                        "required": true|false
                    }
                ]
            },
            {
                "id": "node2",
                "type": "llm",
                "title": "LLM Node",
                "description": "Description of LLM node",
                "system_prompt": "System prompt",
                "user_prompt": "User prompt, variables referenced using {{#nodeID.variable_name#}}, e.g., {{#node1.variable_name#}}",
                "provider": "zhipuai",
                "model": "glm-4-flash",
                "variables": [
                    {
                        "name": "variable_name",
                        "type": "string|number",
                        "source_node": "node1",
                        "source_variable": "variable_name"
                    }
                ]
            },
            {
                "id": "node3",
                "type": "code",
                "title": "Code Node",
                "description": "Description of the code node",
                "code": "def main(input_var):\n    import re\n    match = re.search(r'Result[:：](.*?)(?=[.]|$)', input_var)\n    result = match.group(1).strip() if match else 'Not found'\n    return {'output': result}",
                "variables": [
                    {
                        "name": "input_var",
                        "type": "string|number",
                        "source_node": "node2",
                        "source_variable": "text"
                    }
                ],
                "outputs": [
                    {
                        "name": "output_var_name",
                        "type": "string|number|object"
                    }
                ]
            },
            {
                "id": "node4",
                "type": "template",
                "title": "Template Node",
                "description": "Description of the template node",
                "template": "Template content using double curly braces, e.g.: The result is: {{ result }}",
                "variables": [
                    {
                        "name": "variable_name",
                        "type": "string|number",
                        "source_node": "node3",
                        "source_variable": "output_var_name"
                    }
                ]
            },
            {
                "id": "node5",
                "type": "end",
                "title": "End Node",
                "description": "Description of the end node",
                "outputs": [
                    {
                        "name": "output_variable_name",
                        "type": "string|number",
                        "source_node": "node4",
                        "source_variable": "output"
                    }
                ]
            }
        ],
        "connections": [
            {"source": "node1", "target": "node2"},
            {"source": "node2", "target": "node3"},
            {"source": "node3", "target": "node4"},
            {"source": "node4", "target": "node5"}
        ]
    }
    ```

    Ensure the workflow logic is coherent, node connections are correct, and variable passing is logical.
    Generate unique numeric IDs for each node, e.g., 1740019130520.
    Generate appropriate unique names for each variable across the workflow.
    Ensure all LLM nodes use provider "zhipuai" and model "glm-4-flash".

    Note: LLM nodes usually return a long text; Code nodes typically require regex to extract relevant information.
    """  # noqa: E501
    )

    return prompt_part1
