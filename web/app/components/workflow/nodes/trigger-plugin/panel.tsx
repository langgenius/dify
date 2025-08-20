import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginTriggerNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'

const Panel: FC<NodePanelProps<PluginTriggerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mt-2'>
      <div className='space-y-4 px-4 pb-2'>
        <Field title={t('workflow.nodes.triggerPlugin.title')}>
          {data.plugin_name ? (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium">{data.plugin_name}</span>
                {data.event_type && (
                  <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800">
                    {data.event_type}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500">
                Plugin trigger configured
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              No plugin selected. Configure this trigger in the workflow canvas.
            </div>
          )}
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
