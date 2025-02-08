import { BlockEnum } from './types'

export const ALL_AVAILABLE_BLOCKS = Object.values(BlockEnum)
export const ALL_CHAT_AVAILABLE_BLOCKS = ALL_AVAILABLE_BLOCKS.filter(key => key !== BlockEnum.End && key !== BlockEnum.Start) as BlockEnum[]
export const ALL_COMPLETION_AVAILABLE_BLOCKS = ALL_AVAILABLE_BLOCKS.filter(key => key !== BlockEnum.Answer && key !== BlockEnum.Start) as BlockEnum[]
