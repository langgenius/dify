import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.triggerPlugin'

const Node: FC<NodeProps<PluginTriggerNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className="mb-1 px-3 py-1">
      <div className="text-xs text-gray-700">
        {t(`${i18nPrefix}.nodeTitle`)}
      </div>
      {data.plugin_name && (
        <div className="text-xs text-gray-500">
          {data.plugin_name}
        </div>
      )}
    </div>
  )
}

export default React.memo(Node)
