from collections.abc import Mapping, Sequence
from typing import Any, Literal, Optional
from numbers import Number

from pydantic import BaseModel, Field, field_validator, model_validator

from core.model_runtime.entities import ImagePromptMessageContent, LLMMode
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.workflow.entities.variable_entities import VariableSelector
from core.workflow.nodes.base import BaseNodeData


class ModelConfig(BaseModel):
    provider: str
    name: str
    mode: LLMMode
    completion_params: dict[str, Any] = Field(default_factory=dict)


class ContextConfig(BaseModel):
    enabled: bool
    variable_selector: Optional[list[str]] = None


class VisionConfigOptions(BaseModel):
    variable_selector: Sequence[str] = Field(default_factory=lambda: ["sys", "files"])
    detail: ImagePromptMessageContent.DETAIL = ImagePromptMessageContent.DETAIL.HIGH


class VisionConfig(BaseModel):
    enabled: bool = False
    configs: VisionConfigOptions = Field(default_factory=VisionConfigOptions)

    @field_validator("configs", mode="before")
    @classmethod
    def convert_none_configs(cls, v: Any):
        if v is None:
            return VisionConfigOptions()
        return v


class PromptConfig(BaseModel):
    jinja2_variables: Sequence[VariableSelector] = Field(default_factory=list)

    @field_validator("jinja2_variables", mode="before")
    @classmethod
    def convert_none_jinja2_variables(cls, v: Any):
        if v is None:
            return []
        return v


class LLMNodeChatModelMessage(ChatModelMessage):
    text: str = ""
    jinja2_text: Optional[str] = None


class LLMNodeCompletionModelPromptTemplate(CompletionModelPromptTemplate):
    jinja2_text: Optional[str] = None


class LLMNodeData(BaseNodeData):
    model: ModelConfig
    prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate
    prompt_config: PromptConfig = Field(default_factory=PromptConfig)
    memory: Optional[MemoryConfig] = None
    context: ContextConfig
    vision: VisionConfig = Field(default_factory=VisionConfig)
    structured_output: Mapping[str, Any] | None = None
    # We used 'structured_output_enabled' in the past, but it's not a good name.
    structured_output_switch_on: bool = Field(False, alias="structured_output_enabled")
    reasoning_format: Literal["separated", "tagged"] = Field(
        # Keep tagged as default for backward compatibility
        default="tagged",
        description=(
            """
            Strategy for handling model reasoning output.

            separated: Return clean text (without <think> tags) + reasoning_content field.
                      Recommended for new workflows. Enables safe downstream parsing and
                      workflow variable access: {{#node_id.reasoning_content#}}

            tagged   : Return original text (with <think> tags) + reasoning_content field.
                      Maintains full backward compatibility while still providing reasoning_content
                      for workflow automation. Frontend thinking panels work as before.
            """
        ),
    )

    @field_validator("prompt_config", mode="before")
    @classmethod
    def convert_none_prompt_config(cls, v: Any):
        if v is None:
            return PromptConfig()
        return v

    # ---------------- Structured Output Validation ----------------
    @field_validator("structured_output", mode="before")
    @classmethod
    def validate_structured_output(cls, v: Any):
        """
        Validate structured_output payload shape proactively.
        We only accept the app-supported subset of JSON Schema:
        - structured_output must be an object like {"schema": {...}}
        - schema.type must be "object" with a properties object
        - each property must have a valid type
        - arrays must define items; item.type must be string/number/boolean/object
        - object/array nested fields are recursively validated
        """
        if v is None:
            return v
        if not isinstance(v, Mapping):
            raise ValueError("structured_output must be an object")
        schema = v.get("schema")
        if not isinstance(schema, Mapping):
            raise ValueError("structured_output.schema must be an object")

        def is_valid_enum_item(item: Any) -> bool:
            return isinstance(item, str) or (isinstance(item, Number) and not isinstance(item, bool))

        def is_enum_list(x: Any) -> bool:
            return isinstance(x, list) and all(is_valid_enum_item(i) for i in x)

        allowed_types = {"string", "number", "boolean", "object", "array"}
        allowed_item_types = {"string", "number", "boolean", "object"}

        def validate_field(field: Any, path: str) -> Optional[str]:
            if not isinstance(field, Mapping):
                return f"Field at '{path}' must be an object"
            t = field.get("type")
            if t not in allowed_types:
                return f"Field at '{path}' has invalid or missing type"

            # Optional common keys
            if "description" in field and not isinstance(field.get("description"), str):
                return f"description at '{path}' must be a string"
            if "enum" in field and not is_enum_list(field.get("enum")):
                return f"enum at '{path}' must be an array of strings or numbers"
            if "additionalProperties" in field and not isinstance(field.get("additionalProperties"), bool):
                return f"additionalProperties at '{path}' must be a boolean"

            if t == "object":
                props = field.get("properties")
                if not isinstance(props, Mapping):
                    return f"Object at '{path}' must have a properties object"
                # required array if present
                if "required" in field:
                    req = field.get("required")
                    if not isinstance(req, list) or not all(isinstance(k, str) for k in req):
                        return f"required at '{path}' must be an array of strings"
                for key, sub in props.items():
                    err = validate_field(sub, f"{path}.properties.{key}")
                    if err:
                        return err

            if t == "array":
                items = field.get("items")
                if not isinstance(items, Mapping):
                    return f"Array at '{path}' must define an items schema"
                item_type = items.get("type")
                if item_type not in allowed_item_types:
                    return f"Array items at '{path}' must have type one of {sorted(allowed_item_types)}"
                # If object, allow nested properties validation
                if item_type == "object":
                    err = validate_field(items, f"{path}.items")
                    if err:
                        return err
                else:
                    # Primitive item: allow description/enum checks
                    if "enum" in items and not is_enum_list(items.get("enum")):
                        return f"enum at '{path}.items' must be an array of strings or numbers"
            return None

        # Validate root schema
        if schema.get("type") != "object":
            raise ValueError("structured_output.schema.type must be 'object'")
        if not isinstance(schema.get("properties"), Mapping):
            raise ValueError("structured_output.schema.properties must be an object")

        err = validate_field(schema, "schema")
        if err:
            raise ValueError(err)
        return v

    @model_validator(mode="after")
    def validate_switch_and_schema(self):
        """Ensure when switch is on, a valid structured_output is provided."""
        if self.structured_output_switch_on and not self.structured_output:
            raise ValueError("structured_output must be provided when structured_output_enabled is true")
        return self

    @property
    def structured_output_enabled(self) -> bool:
        return self.structured_output_switch_on and self.structured_output is not None
