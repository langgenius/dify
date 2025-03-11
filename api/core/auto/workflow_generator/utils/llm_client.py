"""
LLM Client
Used to call LLM API
"""

import json
import re
from typing import Any

from core.auto.workflow_generator.utils.debug_manager import DebugManager
from core.auto.workflow_generator.utils.prompts import DEFAULT_SYSTEM_PROMPT
from core.model_manager import ModelInstance
from core.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage


class LLMClient:
    """LLM Client"""

    def __init__(self, model_instance: ModelInstance, debug_manager: DebugManager):
        """
        Initialize LLM client

        Args:
            api_key: API key
            model: Model name
            api_base: API base URL
            max_tokens: Maximum number of tokens to generate
            debug_manager: Debug manager
        """

        self.debug_manager = debug_manager or DebugManager()
        self.model_instance = model_instance

    def generate(self, prompt: str) -> str:
        """
        Generate text

        Args:
            prompt: Prompt text

        Returns:
            Generated text
        """

        # Save prompt
        if self.debug_manager.should_save("prompt"):
            self.debug_manager.save_text(prompt, "prompt.txt", "llm")

        try:
            response = self.model_instance.invoke_llm(
                prompt_messages=[
                    SystemPromptMessage(content=DEFAULT_SYSTEM_PROMPT),
                    UserPromptMessage(content=prompt),
                ],
                model_parameters={"temperature": 0.7, "max_tokens": 4900},
            )
            content = ""
            for chunk in response:
                content += chunk.delta.message.content
            print(f"Generation complete, text length: {len(content)} characters")

            # Save response
            if self.debug_manager.should_save("response"):
                self.debug_manager.save_text(content, "response.txt", "llm")

            return content
        except Exception as e:
            print(f"Error generating text: {e}")
            raise e

    def extract_json(self, text: str) -> dict[str, Any]:
        """
        Extract JSON from text

        Args:
            text: Text containing JSON

        Returns:
            Extracted JSON object
        """
        print("Starting JSON extraction from text...")

        # Save original text
        if self.debug_manager.should_save("json"):
            self.debug_manager.save_text(text, "original_text.txt", "json")

        # Use regex to extract JSON part
        json_match = re.search(r"```json\n(.*?)\n```", text, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
            print("Successfully extracted JSON from code block")
        else:
            # Try to match code block without language identifier
            json_match = re.search(r"```\n(.*?)\n```", text, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
                print("Successfully extracted JSON from code block without language identifier")
            else:
                # Try to match JSON surrounded by curly braces
                json_match = re.search(r"(\{.*\})", text, re.DOTALL)
                if json_match:
                    json_str = json_match.group(1)
                    print("Successfully extracted JSON from curly braces")
                else:
                    # Try to parse entire text
                    json_str = text
                    print("No JSON code block found, attempting to parse entire text")

        # Save extracted JSON string
        if self.debug_manager.should_save("json"):
            self.debug_manager.save_text(json_str, "extracted_json.txt", "json")

        # Try multiple methods to parse JSON
        try:
            # Try direct parsing
            result = json.loads(json_str)
        except json.JSONDecodeError as e:
            print(f"Direct JSON parsing failed: {e}, attempting basic cleaning")
            try:
                # Try basic cleaning
                cleaned_text = self._clean_text(json_str)
                if self.debug_manager.should_save("json"):
                    self.debug_manager.save_text(cleaned_text, "cleaned_json_1.txt", "json")
                result = json.loads(cleaned_text)
            except json.JSONDecodeError as e:
                print(f"JSON parsing after basic cleaning failed: {e}, attempting to fix common errors")
                try:
                    # Try fixing common errors
                    fixed_text = self._fix_json_errors(json_str)
                    if self.debug_manager.should_save("json"):
                        self.debug_manager.save_text(fixed_text, "cleaned_json_2.txt", "json")
                    result = json.loads(fixed_text)
                except json.JSONDecodeError as e:
                    print(f"JSON parsing after fixing common errors failed: {e}, attempting aggressive cleaning")
                    try:
                        # Try aggressive cleaning
                        aggressive_cleaned = self._aggressive_clean(json_str)
                        if self.debug_manager.should_save("json"):
                            self.debug_manager.save_text(aggressive_cleaned, "cleaned_json_3.txt", "json")
                        result = json.loads(aggressive_cleaned)
                    except json.JSONDecodeError as e:
                        print(f"JSON parsing after aggressive cleaning failed: {e}, attempting manual JSON extraction")
                        # Try manual JSON structure extraction
                        result = self._manual_json_extraction(json_str)
                        if self.debug_manager.should_save("json"):
                            self.debug_manager.save_json(result, "manual_json.json", "json")

        # Check for nested workflow structure
        if "workflow" in result and isinstance(result["workflow"], dict):
            print("Detected nested workflow structure, extracting top-level data")
            # Extract workflow name and description
            name = result.get("name", "Text Analysis Workflow")
            description = result.get("description", "")

            # Extract nodes and connections
            nodes = result["workflow"].get("nodes", [])
            connections = []

            # If there are connections, extract them
            if "connections" in result["workflow"]:
                connections = result["workflow"]["connections"]

            # Build standard format workflow description
            result = {"name": name, "description": description, "nodes": nodes, "connections": connections}

        # Save final parsed JSON
        if self.debug_manager.should_save("json"):
            self.debug_manager.save_json(result, "final_json.json", "json")

        print(
            f"JSON parsing successful, contains {len(result.get('nodes', []))} nodes and {len(result.get('connections', []))} connections"  # noqa: E501
        )
        return result

    def _clean_text(self, text: str) -> str:
        """
        Clean text by removing non-JSON characters

        Args:
            text: Text to clean

        Returns:
            Cleaned text
        """
        print("Starting text cleaning...")
        # Remove characters that might cause JSON parsing to fail
        lines = text.split("\n")
        cleaned_lines = []

        in_json = False
        for line in lines:
            if line.strip().startswith("{") or line.strip().startswith("["):
                in_json = True

            if in_json:
                cleaned_lines.append(line)

            if line.strip().endswith("}") or line.strip().endswith("]"):
                in_json = False

        cleaned_text = "\n".join(cleaned_lines)
        print(f"Text cleaning complete, length before: {len(text)}, length after: {len(cleaned_text)}")
        return cleaned_text

    def _fix_json_errors(self, text: str) -> str:
        """
        Fix common JSON errors

        Args:
            text: Text to fix

        Returns:
            Fixed text
        """
        print("Attempting to fix JSON errors...")

        # Replace single quotes with double quotes
        text = re.sub(r"'([^']*)'", r'"\1"', text)

        # Fix missing commas
        text = re.sub(r"}\s*{", "},{", text)
        text = re.sub(r"]\s*{", "],{", text)
        text = re.sub(r"}\s*\[", r"},\[", text)
        text = re.sub(r"]\s*\[", r"],\[", text)

        # Fix extra commas
        text = re.sub(r",\s*}", "}", text)
        text = re.sub(r",\s*]", "]", text)

        # Ensure property names have double quotes
        text = re.sub(r"([{,]\s*)(\w+)(\s*:)", r'\1"\2"\3', text)

        return text

    def _aggressive_clean(self, text: str) -> str:
        """
        More aggressive text cleaning

        Args:
            text: Text to clean

        Returns:
            Cleaned text
        """
        print("Using aggressive cleaning method...")

        # Try to find outermost curly braces
        start_idx = text.find("{")
        end_idx = text.rfind("}")

        if start_idx != -1 and end_idx != -1 and start_idx < end_idx:
            text = text[start_idx : end_idx + 1]

        # Remove comments
        text = re.sub(r"//.*?\n", "\n", text)
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)

        # Fix JSON format
        text = self._fix_json_errors(text)

        # Remove escape characters
        text = text.replace("\\n", "\n").replace("\\t", "\t").replace('\\"', '"')

        # Fix potential Unicode escape issues
        text = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), text)

        return text

    def _manual_json_extraction(self, text: str) -> dict[str, Any]:
        """
        Manual JSON structure extraction

        Args:
            text: Text to extract from

        Returns:
            Extracted JSON object
        """
        print("Attempting manual JSON structure extraction...")

        # Extract workflow name
        name_match = re.search(r'"name"\s*:\s*"([^"]*)"', text)
        name = name_match.group(1) if name_match else "Simple Workflow"

        # Extract workflow description
        desc_match = re.search(r'"description"\s*:\s*"([^"]*)"', text)
        description = desc_match.group(1) if desc_match else "Automatically generated workflow"

        # Extract nodes
        nodes = []
        node_matches = re.finditer(r'\{\s*"id"\s*:\s*"([^"]*)"\s*,\s*"type"\s*:\s*"([^"]*)"', text)

        for match in node_matches:
            node_id = match.group(1)
            node_type = match.group(2)

            # Extract node title
            title_match = re.search(rf'"id"\s*:\s*"{node_id}".*?"title"\s*:\s*"([^"]*)"', text, re.DOTALL)
            title = title_match.group(1) if title_match else f"{node_type.capitalize()} Node"

            # Extract node description
            desc_match = re.search(rf'"id"\s*:\s*"{node_id}".*?"description"\s*:\s*"([^"]*)"', text, re.DOTALL)
            desc = desc_match.group(1) if desc_match else ""

            # Create basic node based on node type
            if node_type == "start":
                # Extract variables
                variables = []
                var_section_match = re.search(rf'"id"\s*:\s*"{node_id}".*?"variables"\s*:\s*\[(.*?)\]', text, re.DOTALL)

                if var_section_match:
                    var_section = var_section_match.group(1)
                    var_matches = re.finditer(r'\{\s*"name"\s*:\s*"([^"]*)"\s*,\s*"type"\s*:\s*"([^"]*)"', var_section)

                    for var_match in var_matches:
                        var_name = var_match.group(1)
                        var_type = var_match.group(2)

                        # Extract variable description
                        var_desc_match = re.search(
                            rf'"name"\s*:\s*"{var_name}".*?"description"\s*:\s*"([^"]*)"', var_section, re.DOTALL
                        )
                        var_desc = var_desc_match.group(1) if var_desc_match else ""

                        # Extract required status
                        var_required_match = re.search(
                            rf'"name"\s*:\s*"{var_name}".*?"required"\s*:\s*(true|false)', var_section, re.DOTALL
                        )
                        var_required = var_required_match.group(1).lower() == "true" if var_required_match else True

                        variables.append(
                            {"name": var_name, "type": var_type, "description": var_desc, "required": var_required}
                        )

                # If no variables found but this is a greeting workflow, add default user_name variable
                if not variables and ("greeting" in name.lower()):
                    variables.append(
                        {"name": "user_name", "type": "string", "description": "User's name", "required": True}
                    )

                nodes.append({"id": node_id, "type": "start", "title": title, "desc": desc, "variables": variables})
            elif node_type == "llm":
                # Extract system prompt
                system_prompt_match = re.search(
                    rf'"id"\s*:\s*"{node_id}".*?"system_prompt"\s*:\s*"([^"]*)"', text, re.DOTALL
                )
                system_prompt = system_prompt_match.group(1) if system_prompt_match else "You are a helpful assistant"

                # Extract user prompt
                user_prompt_match = re.search(
                    rf'"id"\s*:\s*"{node_id}".*?"user_prompt"\s*:\s*"([^"]*)"', text, re.DOTALL
                )
                user_prompt = user_prompt_match.group(1) if user_prompt_match else "Please answer the user's question"

                nodes.append(
                    {
                        "id": node_id,
                        "type": "llm",
                        "title": title,
                        "desc": desc,
                        "provider": "zhipuai",
                        "model": "glm-4-flash",
                        "system_prompt": system_prompt,
                        "user_prompt": user_prompt,
                        "variables": [],
                    }
                )
            elif node_type in ("template", "template-transform"):
                # Extract template content
                template_match = re.search(rf'"id"\s*:\s*"{node_id}".*?"template"\s*:\s*"([^"]*)"', text, re.DOTALL)
                template = template_match.group(1) if template_match else ""

                # Fix triple curly brace issue in template, replace {{{ with {{ and }}} with }}
                template = template.replace("{{{", "{{").replace("}}}", "}}")

                nodes.append(
                    {
                        "id": node_id,
                        "type": "template-transform",
                        "title": title,
                        "desc": desc,
                        "template": template,
                        "variables": [],
                    }
                )
            elif node_type == "end":
                # Extract outputs
                outputs = []
                output_section_match = re.search(
                    rf'"id"\s*:\s*"{node_id}".*?"outputs"\s*:\s*\[(.*?)\]', text, re.DOTALL
                )

                if output_section_match:
                    output_section = output_section_match.group(1)
                    output_matches = re.finditer(
                        r'\{\s*"name"\s*:\s*"([^"]*)"\s*,\s*"type"\s*:\s*"([^"]*)"', output_section
                    )

                    for output_match in output_matches:
                        output_name = output_match.group(1)
                        output_type = output_match.group(2)

                        # Extract source node
                        source_node_match = re.search(
                            rf'"name"\s*:\s*"{output_name}".*?"source_node"\s*:\s*"([^"]*)"', output_section, re.DOTALL
                        )
                        source_node = source_node_match.group(1) if source_node_match else ""

                        # Extract source variable
                        source_var_match = re.search(
                            rf'"name"\s*:\s*"{output_name}".*?"source_variable"\s*:\s*"([^"]*)"',
                            output_section,
                            re.DOTALL,
                        )
                        source_var = source_var_match.group(1) if source_var_match else ""

                        outputs.append(
                            {
                                "name": output_name,
                                "type": output_type,
                                "source_node": source_node,
                                "source_variable": source_var,
                            }
                        )

                nodes.append({"id": node_id, "type": "end", "title": title, "desc": desc, "outputs": outputs})
            else:
                # Other node types
                nodes.append({"id": node_id, "type": node_type, "title": title, "desc": desc})

        # Extract connections
        connections = []
        conn_matches = re.finditer(r'\{\s*"source"\s*:\s*"([^"]*)"\s*,\s*"target"\s*:\s*"([^"]*)"', text)

        for match in conn_matches:
            connections.append({"source": match.group(1), "target": match.group(2)})

        return {"name": name, "description": description, "nodes": nodes, "connections": connections}
