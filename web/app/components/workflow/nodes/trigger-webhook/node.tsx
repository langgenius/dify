import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { WebhookTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<WebhookTriggerNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className="mb-1 px-3 py-1">
      <div className="text-xs text-gray-700">
        {t('workflow.nodes.triggerWebhook.nodeTitle')}
      </div>
      {data.http_methods && data.http_methods.length > 0 && (
        <div className="text-xs text-gray-500">
          {data.http_methods.join(', ')}
        </div>
      )}
    </div>
  )
}

export default React.memo(Node)
