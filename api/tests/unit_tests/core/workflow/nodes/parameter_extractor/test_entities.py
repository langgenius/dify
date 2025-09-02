from core.variables.types import SegmentType
from core.workflow.nodes.parameter_extractor.entities import ParameterConfig


class TestParameterConfig:
    def test_select_type(self):
        data = {
            "name": "yes_or_no",
            "type": "select",
            "options": ["yes", "no"],
            "description": "a simple select made of `yes` and `no`",
            "required": True,
        }

        pc = ParameterConfig.model_validate(data)
        assert pc.type == SegmentType.STRING
        assert pc.options == data["options"]

    def test_validate_bool_type(self):
        data = {
            "name": "boolean",
            "type": "bool",
            "description": "a simple boolean parameter",
            "required": True,
        }
        pc = ParameterConfig.model_validate(data)
        assert pc.type == SegmentType.BOOLEAN
