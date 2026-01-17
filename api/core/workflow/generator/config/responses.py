"""
Response Templates for Vibe Workflow Generation.

This module defines templates for off-topic responses and default suggestions
to guide users back to workflow-related requests.
"""

# Off-topic response templates for different categories
# Each category has messages in multiple languages
OFF_TOPIC_RESPONSES: dict[str, dict[str, str]] = {
    "weather": {
        "en": (
            "I'm the workflow design assistant - I can't check the weather, "
            "but I can help you build AI workflows! For example, I could help you "
            "create a workflow that fetches weather data from an API."
        ),
        "zh": "我是工作流设计助手，无法查询天气。但我可以帮你创建一个从API获取天气数据的工作流！",
    },
    "math": {
        "en": (
            "I focus on workflow design rather than calculations. However, "
            "if you need calculations in a workflow, I can help you add a Code node "
            "that handles math operations!"
        ),
        "zh": "我专注于工作流设计而非计算。但如果您需要在工作流中进行计算，我可以帮您添加一个处理数学运算的代码节点！",
    },
    "joke": {
        "en": (
            "While I'd love to share a laugh, I'm specialized in workflow design. "
            "How about we create something fun instead - like a workflow that generates jokes using AI?"
        ),
        "zh": "虽然我很想讲笑话，但我专门从事工作流设计。不如我们创建一个有趣的东西——比如使用AI生成笑话的工作流？",
    },
    "translation": {
        "en": (
            "I can't translate directly, but I can help you build a translation workflow! "
            "Would you like to create one using an LLM node?"
        ),
        "zh": "我不能直接翻译，但我可以帮你构建一个翻译工作流！要创建一个使用LLM节点的翻译流程吗？",
    },
    "general_coding": {
        "en": (
            "I'm specialized in Dify workflow design rather than general coding help. "
            "But if you want to add code logic to your workflow, I can help you configure a Code node!"
        ),
        "zh": (
            "我专注于Dify工作流设计，而非通用编程帮助。但如果您想在工作流中添加代码逻辑，我可以帮您配置一个代码节点！"
        ),
    },
    "default": {
        "en": (
            "I'm the Dify workflow design assistant. I help create AI automation workflows, "
            "but I can't help with general questions. Would you like to create a workflow instead?"
        ),
        "zh": "我是Dify工作流设计助手。我帮助创建AI自动化工作流，但无法回答一般性问题。您想创建一个工作流吗？",
    },
}

# Default suggestions for off-topic requests
# These help guide users towards valid workflow requests
DEFAULT_SUGGESTIONS: dict[str, list[str]] = {
    "en": [
        "Create a chatbot workflow",
        "Build a document summarization pipeline",
        "Add email notification to workflow",
    ],
    "zh": [
        "创建一个聊天机器人工作流",
        "构建文档摘要处理流程",
        "添加邮件通知到工作流",
    ],
}
