import json
from typing import Any

import yaml

from core.auto.node_types.common import CompleteEdge, CompleteNode


class Workflow:
    """
    Workflow class
    """

    def __init__(self, name: str, nodes: list[CompleteNode], edges: list[CompleteEdge]):
        """
        Initialize workflow

        Args:
            name: Workflow name
            nodes: List of nodes
            edges: List of edges
        """
        self.name = name
        self.nodes = nodes
        self.edges = edges

    def to_dict(self) -> dict[str, Any]:
        """
        Convert workflow to dictionary

        Returns:
            Workflow dictionary
        """
        # Apply basic information (fixed template)
        app_info = {
            "description": "",
            "icon": "🤖",
            "icon_background": "#FFEAD5",
            "mode": "workflow",
            "name": self.name,
            "use_icon_as_answer_icon": False,
        }

        # Feature configuration (fixed template)
        features = {
            "file_upload": {
                "allowed_file_extensions": [".JPG", ".JPEG", ".PNG", ".GIF", ".WEBP", ".SVG"],
                "allowed_file_types": ["image"],
                "allowed_file_upload_methods": ["local_file", "remote_url"],
                "enabled": False,
                "fileUploadConfig": {
                    "audio_file_size_limit": 50,
                    "batch_count_limit": 5,
                    "file_size_limit": 15,
                    "image_file_size_limit": 10,
                    "video_file_size_limit": 100,
                },
                "image": {"enabled": False, "number_limits": 3, "transfer_methods": ["local_file", "remote_url"]},
                "number_limits": 3,
            },
            "opening_statement": "",
            "retriever_resource": {"enabled": True},
            "sensitive_word_avoidance": {"enabled": False},
            "speech_to_text": {"enabled": False},
            "suggested_questions": [],
            "suggested_questions_after_answer": {"enabled": False},
            "text_to_speech": {"enabled": False, "language": "", "voice": ""},
        }

        # View configuration (fixed template)
        viewport = {"x": 92.96659905656679, "y": 79.13437154762897, "zoom": 0.9002006986311041}

        # Nodes and edges
        nodes_data = []
        for node in self.nodes:
            node_data = node.to_json()
            nodes_data.append(node_data)

        edges_data = []
        for edge in self.edges:
            edge_data = edge.to_json()
            edges_data.append(edge_data)

        # Build a complete workflow dictionary
        workflow_dict = {
            "app": app_info,
            "kind": "app",
            "version": "0.1.2",
            "workflow": {
                "conversation_variables": [],
                "environment_variables": [],
                "features": features,
                "graph": {"edges": edges_data, "nodes": nodes_data, "viewport": viewport},
            },
        }

        return workflow_dict

    def save_to_yaml(self, file_path: str):
        """
        Save workflow to YAML file

        Args:
            file_path: File path
        """
        workflow_dict = self.to_dict()

        with open(file_path, "w", encoding="utf-8") as f:
            yaml.dump(workflow_dict, f, allow_unicode=True, sort_keys=False)

        print(f"Workflow saved to: {file_path}")

    def save_to_json(self, file_path: str):
        """
        Save workflow to JSON file

        Args:
            file_path: File path
        """
        workflow_dict = self.to_dict()

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(workflow_dict, f, indent=2, ensure_ascii=False)

        print(f"Workflow saved to: {file_path}")

    def to_yaml(self) -> str:
        """
        Convert workflow to YAML string

        Returns:
            YAML string
        """
        return yaml.dump(self.to_dict(), allow_unicode=True, sort_keys=False)
