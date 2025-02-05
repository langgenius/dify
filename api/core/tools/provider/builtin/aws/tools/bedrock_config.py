"""
Configuration classes for AWS Bedrock retrieve and generate API
"""

from dataclasses import dataclass
from typing import Any, Literal, Optional


@dataclass
class TextInferenceConfig:
    """Text inference configuration"""

    maxTokens: Optional[int] = None
    stopSequences: Optional[list[str]] = None
    temperature: Optional[float] = None
    topP: Optional[float] = None


@dataclass
class PerformanceConfig:
    """Performance configuration"""

    latency: Literal["standard", "optimized"]


@dataclass
class PromptTemplate:
    """Prompt template configuration"""

    textPromptTemplate: str


@dataclass
class GuardrailConfig:
    """Guardrail configuration"""

    guardrailId: str
    guardrailVersion: str


@dataclass
class GenerationConfig:
    """Generation configuration"""

    additionalModelRequestFields: Optional[dict[str, Any]] = None
    guardrailConfiguration: Optional[GuardrailConfig] = None
    inferenceConfig: Optional[dict[str, TextInferenceConfig]] = None
    performanceConfig: Optional[PerformanceConfig] = None
    promptTemplate: Optional[PromptTemplate] = None


@dataclass
class VectorSearchConfig:
    """Vector search configuration"""

    filter: Optional[dict[str, Any]] = None
    numberOfResults: Optional[int] = None
    overrideSearchType: Optional[Literal["HYBRID", "SEMANTIC"]] = None


@dataclass
class RetrievalConfig:
    """Retrieval configuration"""

    vectorSearchConfiguration: VectorSearchConfig


@dataclass
class OrchestrationConfig:
    """Orchestration configuration"""

    additionalModelRequestFields: Optional[dict[str, Any]] = None
    inferenceConfig: Optional[dict[str, TextInferenceConfig]] = None
    performanceConfig: Optional[PerformanceConfig] = None
    promptTemplate: Optional[PromptTemplate] = None


@dataclass
class KnowledgeBaseConfig:
    """Knowledge base configuration"""

    generationConfiguration: GenerationConfig
    knowledgeBaseId: str
    modelArn: str
    orchestrationConfiguration: Optional[OrchestrationConfig] = None
    retrievalConfiguration: Optional[RetrievalConfig] = None


@dataclass
class SessionConfig:
    """Session configuration"""

    kmsKeyArn: Optional[str] = None
    sessionId: Optional[str] = None


@dataclass
class RetrieveAndGenerateConfiguration:
    """Retrieve and generate configuration
    The use of knowledgeBaseConfiguration or externalSourcesConfiguration depends on the type value
    """

    type: str = "KNOWLEDGE_BASE"
    knowledgeBaseConfiguration: Optional[KnowledgeBaseConfig] = None


@dataclass
class RetrieveAndGenerateConfig:
    """Retrieve and generate main configuration"""

    input: dict[str, str]
    retrieveAndGenerateConfiguration: RetrieveAndGenerateConfiguration
    sessionConfiguration: Optional[SessionConfig] = None
    sessionId: Optional[str] = None
