"""
Workflow Generator
Used to generate Dify workflows based on user requirements
"""

from pydantic import ValidationError

from core.auto.workflow_generator.generators.edge_generator import EdgeGenerator
from core.auto.workflow_generator.generators.layout_engine import LayoutEngine
from core.auto.workflow_generator.generators.node_generator import NodeGenerator
from core.auto.workflow_generator.models.workflow_description import WorkflowDescription
from core.auto.workflow_generator.utils.config_manager import ConfigManager
from core.auto.workflow_generator.utils.debug_manager import DebugManager
from core.auto.workflow_generator.utils.llm_client import LLMClient
from core.auto.workflow_generator.utils.prompts import build_workflow_prompt
from core.auto.workflow_generator.workflow import Workflow
from core.model_manager import ModelInstance


class WorkflowGenerator:
    """Workflow generator for creating Dify workflows based on user requirements"""

    def __init__(self, model_instance: ModelInstance, config_dir: str = "config", debug_enabled: bool = False):
        """
        Initialize workflow generator

        Args:
            api_key: LLM API key
            config_dir: Configuration directory path
            model_name: Specified model name, uses default model if not specified
            debug_enabled: Whether to enable debug mode
        """
        # Load configuration
        self.config = ConfigManager(config_dir)

        # Initialize debug manager
        self.debug_manager = DebugManager(config=self.config.get("debug", default={}), debug_enabled=debug_enabled)

        # Get model configuration

        # Initialize LLM client
        self.llm_client = LLMClient(model_instance=model_instance, debug_manager=self.debug_manager)

    def generate_workflow(self, user_requirement: str) -> str:
        """
        Generate workflow based on user requirements

        Args:
            user_requirement: User requirement description
            output_path: Output file path, uses default path from config if None

        Returns:
            Generated workflow YAML file path
        """
        print("\n===== Starting Workflow Generation =====")
        print(f"User requirement: {user_requirement}")

        # Save user requirement
        if self.debug_manager.should_save("workflow"):
            self.debug_manager.save_text(user_requirement, "user_requirement.txt", "workflow")

        # Use default path from config if output path not specified

        # Step 1: Generate simple workflow description
        print("\n----- Step 1: Generating Simple Workflow Description -----")
        workflow_description = self._generate_workflow_description(user_requirement)
        print(f"Workflow name: {workflow_description.name}")
        print(f"Workflow description: {workflow_description.description}")
        print(f"Number of nodes: {len(workflow_description.nodes)}")
        print(f"Number of connections: {len(workflow_description.connections)}")

        # Save workflow description
        if self.debug_manager.should_save("workflow"):
            self.debug_manager.save_json(workflow_description.dict(), "workflow_description.json", "workflow")

        # Step 2: Parse description and generate nodes
        print("\n----- Step 2: Parsing Description, Generating Nodes -----")
        nodes = NodeGenerator.create_nodes(workflow_description.nodes)
        print(f"Generated nodes: {len(nodes)}")
        for i, node in enumerate(nodes):
            print(f"Node {i + 1}: ID={node.id}, Type={node.data.type.value}, Title={node.data.title}")

        # Save node information
        if self.debug_manager.should_save("workflow"):
            nodes_data = [node.dict() for node in nodes]
            self.debug_manager.save_json(nodes_data, "nodes.json", "workflow")

        # Step 3: Generate edges
        print("\n----- Step 3: Generating Edges -----")
        edges = EdgeGenerator.create_edges(nodes, workflow_description.connections)
        print(f"Generated edges: {len(edges)}")
        for i, edge in enumerate(edges):
            print(f"Edge {i + 1}: ID={edge.id}, Source={edge.source}, Target={edge.target}")

        # Save edge information
        if self.debug_manager.should_save("workflow"):
            edges_data = [edge.dict() for edge in edges]
            self.debug_manager.save_json(edges_data, "edges.json", "workflow")

        # Step 4: Apply layout
        print("\n----- Step 4: Applying Layout -----")
        LayoutEngine.apply_topological_layout(nodes, edges)
        print("Applied topological sort layout")

        # Save nodes with layout
        if self.debug_manager.should_save("workflow"):
            nodes_with_layout = [node.dict() for node in nodes]
            self.debug_manager.save_json(nodes_with_layout, "nodes_with_layout.json", "workflow")

        # Step 5: Generate YAML
        print("\n----- Step 5: Generating YAML -----")
        workflow = Workflow(name=workflow_description.name, nodes=nodes, edges=edges)

        # Ensure output directory exists

        # Save as YAML

        # Save final YAML
        print("\n===== Workflow Generation Complete =====")
        return workflow.to_yaml()

    def _generate_workflow_description(self, user_requirement: str) -> WorkflowDescription:
        """
        Generate simple workflow description using LLM

        Args:
            user_requirement: User requirement description

        Returns:
            Simple workflow description
        """
        # Build prompt
        print("Building prompt...")
        prompt = build_workflow_prompt(user_requirement)

        # Call LLM
        print("Calling LLM to generate workflow description...")
        response_text = self.llm_client.generate(prompt)

        # Parse LLM response
        print("Parsing LLM response...")
        workflow_description_dict = self.llm_client.extract_json(response_text)

        try:
            # Parse into WorkflowDescription object
            print("Converting JSON to WorkflowDescription object...")
            workflow_description = WorkflowDescription.parse_obj(workflow_description_dict)
            return workflow_description
        except ValidationError as e:
            # If parsing fails, print error and raise exception
            error_msg = f"Failed to parse workflow description: {e}"
            print(error_msg)

            # Save error information
            if self.debug_manager.should_save("workflow"):
                self.debug_manager.save_text(str(e), "validation_error.txt", "workflow")
                self.debug_manager.save_json(workflow_description_dict, "invalid_workflow_description.json", "workflow")

            raise ValueError(error_msg)
