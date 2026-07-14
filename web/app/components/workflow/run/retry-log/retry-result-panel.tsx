'use client'

import type { NodeTracing } from '@/types/workflow'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import NodePanel from '../node'

type Props = {
  readonly list: NodeTracing[]
  readonly onBack: () => void
}

function RetryResultPanel({ list, onBack }: Props) {
  const { t } = useTranslation()

  return (
    <div>
      <button
        type="button"
        className="flex h-8 w-full cursor-pointer items-center bg-components-panel-bg px-4 system-sm-medium text-text-accent-secondary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onBack()
        }}
      >
        <span aria-hidden className="mr-1 i-ri-arrow-left-line size-4" />
        {t(($) => $['singleRun.back'], { ns: 'workflow' })}
      </button>
      <div className="bg-background-section-burn py-2">
        {list.map((item, index) => (
          <NodePanel
            key={`${item.id}:${item.retry_index ?? item.created_at}`}
            nodeInfo={{
              ...item,
              title: `${t(($) => $['nodes.common.retry.retry'], { ns: 'workflow' })} ${index + 1}`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
export default memo(RetryResultPanel)
