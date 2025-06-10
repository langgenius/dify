import type {
    CommonNodeType,
    Memory,
    ModelConfig, ValueSelector,
    VisionSetting
} from '@/app/components/workflow/types'
import {Param, ReasoningModeType} from "@/app/components/workflow/nodes/parameter-extractor/types";

export type VannaNodeType = CommonNodeType & {
    model: ModelConfig
    query: ValueSelector
    instruction: string
    reasoning_mode: ReasoningModeType
    parameters: Param[]
    memory?: Memory
    vision: {
        enabled: boolean
        configs?: VisionSetting
    }
}
