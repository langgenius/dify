import type { FC } from 'react'
import React from 'react'
import type { PluginTriggerNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { useAllTriggerPlugins } from '@/service/use-triggers'

const Panel: FC<NodePanelProps<PluginTriggerNodeType>> = ({
  data,
}) => {
  const { data: triggerPlugins = [] } = useAllTriggerPlugins()

  // Find the current trigger provider and specific trigger
  const currentProvider = triggerPlugins.find(provider =>
    provider.name === data.provider_name || provider.id === data.provider_id,
  )

  const currentTrigger = currentProvider?.tools.find(tool =>
    tool.name === data.plugin_name,
  )

  // Get output schema from the trigger
  const outputSchema = currentTrigger?.output_schema || {}

  // Convert output schema to VarItem format
  const outputVars = Object.entries(outputSchema.properties || {}).map(([name, schema]: [string, any]) => ({
    name,
    type: schema.type || 'string',
    description: schema.description || '',
  }))

  return (
    <div className='mt-2'>
      <div className='space-y-4 px-4 pb-2'>
        <Field title="Plugin Trigger">
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

      <Split />

      <OutputVars>
        <>
          {outputVars.map(varItem => (
            <VarItem
              key={varItem.name}
              name={varItem.name}
              type={varItem.type}
              description={varItem.description}
            />
          ))}
        </>
      </OutputVars>
    </div>
  )
}

export default React.memo(Panel)
