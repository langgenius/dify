import { ModelEnum } from '../declarations'
import type { ModelConfig } from '../declarations'
import { IflytekSparkText, IflytekSparkTextCn } from '@/app/components/base/icons/src/public/llm'

const config: ModelConfig = {
  key: ModelEnum.spark,
  item: {
    key: ModelEnum.spark,
    titleIcon: {
      'en': <IflytekSparkText className='h-6' />,
      'zh-Hans': <IflytekSparkTextCn className='h-6' />,
    },
    vender: {
      'en': 'Earn 3 million tokens for free',
      'zh-Hans': '免费获取 300 万个 token',
    },
  },
}

export default config
