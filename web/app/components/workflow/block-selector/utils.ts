import type { BlockEnum } from '../types'
import { BLOCKS } from './constants'

export const getBlockByType = (type: BlockEnum) => {
  return BLOCKS.find(block => block.type === type)
}
