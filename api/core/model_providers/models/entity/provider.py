from enum import Enum


class ProviderQuotaUnit(Enum):
    TIMES = 'times'
    TOKENS = 'tokens'


class ModelFeature(Enum):
    AGENT_THOUGHT = 'agent_thought'
