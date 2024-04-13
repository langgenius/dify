from base64 import b64encode
from enum import Enum
from typing import Any, cast

from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import (
    PromptMessageContent,
    PromptMessageContentType,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.tools.entities.tool_entities import ModelToolPropertyKey, ToolInvokeMessage, ToolProviderType
from core.tools.tool.tool import Tool

VISION_PROMPT = """## Image Recognition Task
### Task Description
I require a powerful vision language model for an image recognition task. The model should be capable of extracting various details from the images, including but not limited to text content, layout distribution, color distribution, main subjects, and emotional expressions.
### Specific Requirements
1. **Text Content Extraction:** Ensure that the model accurately recognizes and extracts text content from the images, regardless of text size, font, or color.
2. **Layout Distribution Analysis:** The model should analyze the layout structure of the images, capturing the relationships between various elements and providing detailed information about the image layout.
3. **Color Distribution Analysis:** Extract information about color distribution in the images, including primary colors, color combinations, and other relevant details.
4. **Main Subject Recognition:** The model should accurately identify the main subjects in the images and provide detailed descriptions of these subjects.
5. **Emotional Expression Analysis:** Analyze and describe the emotions or expressions conveyed in the images based on facial expressions, postures, and other relevant features.
### Additional Considerations
- Ensure that the extracted information is as comprehensive and accurate as possible.
- For each task, provide confidence scores or relevance scores for the model outputs to assess the reliability of the results.
- If necessary, pose specific questions for different tasks to guide the model in better understanding the images and providing relevant information."""

class ModelTool(Tool):
    class ModelToolType(Enum):
        """
            the type of the model tool
        """
        VISION = 'vision'

    model_configuration: dict[str, Any] = None
    tool_type: ModelToolType
    
    def __init__(self, model_instance: ModelInstance = None, model: str = None, 
                 tool_type: ModelToolType = ModelToolType.VISION, 
                 properties: dict[ModelToolPropertyKey, Any] = None,
                 **kwargs):
        """
            init the tool
        """
        kwargs['model_configuration'] = {
            'model_instance': model_instance,
            'model': model,
            'properties': properties
        }
        kwargs['tool_type'] = tool_type
        super().__init__(**kwargs)

    """
    Model tool
    """
    def fork_tool_runtime(self, meta: dict[str, Any]) -> 'Tool':
        """
            fork a new tool with meta data

            :param meta: the meta data of a tool call processing, tenant_id is required
            :return: the new tool
        """
        return self.__class__(
            identity=self.identity.copy() if self.identity else None,
            parameters=self.parameters.copy() if self.parameters else None,
            description=self.description.copy() if self.description else None,
            model_instance=self.model_configuration['model_instance'],
            model=self.model_configuration['model'],
            tool_type=self.tool_type,
            runtime=Tool.Runtime(**meta)
        )

    def validate_credentials(self, credentials: dict[str, Any], parameters: dict[str, Any], format_only: bool = False) -> None:
        """
            validate the credentials for Model tool
        """
        pass

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        """
        model_instance = self.model_configuration['model_instance']
        if not model_instance:
            return self.create_text_message('the tool is not configured correctly')
        
        if self.tool_type == ModelTool.ModelToolType.VISION:
            return self._invoke_llm_vision(user_id, tool_parameters)
        else:
            return self.create_text_message('the tool is not configured correctly')
        
    def _invoke_llm_vision(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        # get image
        image_parameter_name = self.model_configuration['properties'].get(ModelToolPropertyKey.IMAGE_PARAMETER_NAME, 'image_id')
        image_id = tool_parameters.pop(image_parameter_name, '')
        if not image_id:
            image = self.get_default_image_variable()
            if not image:
                return self.create_text_message('Please upload an image or input image_id')
        else:
            image = self.get_variable(image_id)
            if not image:
                image = self.get_default_image_variable()
                if not image:
                    return self.create_text_message('Please upload an image or input image_id')
        
        if not image:
            return self.create_text_message('Please upload an image or input image_id')
        
        # get image
        image = self.get_variable_file(image.name)
        if not image:
            return self.create_text_message('Failed to get image')
        
        # organize prompt messages
        prompt_messages = [
            SystemPromptMessage(
                content=VISION_PROMPT
            ),
            UserPromptMessage(
                content=[
                    PromptMessageContent(
                        type=PromptMessageContentType.TEXT,
                        data='Recognize the image and extract the information from the image.'
                    ),
                    PromptMessageContent(
                        type=PromptMessageContentType.IMAGE,
                        data=f'data:image/png;base64,{b64encode(image).decode("utf-8")}'
                    )
                ]
            )
        ]

        llm_instance = cast(LargeLanguageModel, self.model_configuration['model_instance'])
        result: LLMResult = llm_instance.invoke(
            model=self.model_configuration['model'],
            credentials=self.runtime.credentials,
            prompt_messages=prompt_messages,
            model_parameters=tool_parameters,
            tools=[],
            stop=[],
            stream=False,
            user=user_id,
        )

        if not result:
            return self.create_text_message('Failed to extract information from the image')
        
        # get result
        content = result.message.content
        if not content:
            return self.create_text_message('Failed to extract information from the image')
        
        return self.create_text_message(content)