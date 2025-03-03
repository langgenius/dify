import type { ApoToolTypeInfo } from './types'

export const initApoToolsEntry: Record<ApoToolTypeInfo, any> = {
  select: {
    label: 'APO异常检测',
    description: 'APO异常检测分析描述',
    icon: '',
    type: 'select',
  },
  analysis: {
    label: 'APO查询检测',
    description: 'APO查询检测',
    icon: '',
    type: 'analysis',
  },
}
