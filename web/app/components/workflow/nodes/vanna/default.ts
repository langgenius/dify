import type {NodeDefault} from '../../types'
import {BlockEnum} from '../../types'
import type {VannaNodeType} from './types'
import {ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS} from '@/app/components/workflow/blocks'
import {ReasoningModeType} from "@/app/components/workflow/nodes/parameter-extractor/types";

const nodeDefault: NodeDefault<VannaNodeType> = {
    defaultValue: {
        query: [],
        model: {
            provider: '',
            name: '',
            mode: 'chat',
            completion_params: {
                temperature: 0.7,
            },
        },
        reasoning_mode: ReasoningModeType.prompt,
        vision: {
            enabled: false,
        },
    },
    getAvailablePrevNodes(isChatMode: boolean) {
        return isChatMode
            ? ALL_CHAT_AVAILABLE_BLOCKS
            : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    },
    getAvailableNextNodes(isChatMode: boolean) {
        return isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    },
    checkValid(payload: VannaNodeType) {
        let isValid = true
        let errorMessages = ''
        if (!payload.query || payload.query.length === 0){
            errorMessages = '输入变量不能为空'
        }

        return {
            isValid,
            errorMessage: errorMessages,
        }
    },
}

export default nodeDefault
