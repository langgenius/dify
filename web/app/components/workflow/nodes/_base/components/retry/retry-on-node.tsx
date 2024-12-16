import { useTranslation } from 'react-i18next'
import type { Node } from '@/app/components/workflow/types'

type RetryOnNodeProps = Pick<Node, 'id' | 'data'>
const RetryOnNode = ({
  data,
}: RetryOnNodeProps) => {
  const { t } = useTranslation()
  const { retry_config } = data

  if (!retry_config)
    return null

  return (
    <div className='px-3'>
      <div className='flex items-center px-[5px] py-1 bg-workflow-block-parma-bg rounded-md system-xs-medium-uppercase text-text-tertiary'>
        {t('workflow.nodes.common.retry.retryTimes', { times: retry_config.max_retries })}
      </div>
    </div>
  )
}

export default RetryOnNode
