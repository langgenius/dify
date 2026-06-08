import type { FC } from 'react'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'nodes.startPlaceholder'

const Node: FC<NodeProps> = () => {
  const { t } = useTranslation()

  return (
    <div className="mb-1 px-3 py-1">
      <div className="rounded-lg border border-components-panel-border-subtle bg-workflow-block-parma-bg px-2.5 py-2">
        <div className="flex items-start gap-2">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-components-button-primary-bg text-text-primary-on-surface">
            <span className="i-ri-arrow-right-line size-3.5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="system-xs-medium text-text-secondary">
              {t(`${i18nPrefix}.nodeTitle`, { ns: 'workflow' })}
            </div>
            <div className="mt-0.5 system-2xs-regular text-text-tertiary">
              {t(`${i18nPrefix}.nodeDescription`, { ns: 'workflow' })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(Node)
