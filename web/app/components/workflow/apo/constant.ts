import type { ApoToolTypeInfo } from './types'

export const initApoToolsEntry: Record<ApoToolTypeInfo, any> = {
  select: {
    label: 'APO平台查询可观测性数据',
    description: '查询APO平台可观测性数据, 用于进一步分析',
    icon: '',
    type: 'select',
  },
  analysis: {
    label: 'APO数据异常检测&关联',
    description: '输入可观测性数据, 通过相关算法识别出现异常数据、或者直接对数据进行关联汇总。',
    icon: '',
    type: 'analysis',
  },
}
