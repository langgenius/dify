import type { FC } from 'react'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from '#i18n'

const i18nPrefix = 'nodes.startPlaceholder'

const Node: FC<NodeProps> = ({
  data,
}) => {
  const { t } = useTranslation()
  const descriptionKey = data.selected ? 'nodeDescription' : 'nodeCollapsedDescription'

  return (
    <div className="px-2.5 py-1">
      <div className="rounded-md bg-workflow-block-parma-bg px-1.5 py-[5px]">
        <div className="system-xs-regular wrap-break-word text-text-tertiary">
          {t(`${i18nPrefix}.${descriptionKey}`, { ns: 'workflow' })}
        </div>
      </div>
    </div>
  )
}

export default React.memo(Node)
