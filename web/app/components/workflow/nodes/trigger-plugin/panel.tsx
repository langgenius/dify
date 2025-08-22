import type { FC } from 'react'
import React from 'react'
import type { PluginTriggerNodeType } from './types'
import useConfig from './use-config'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import ToolForm from '@/app/components/workflow/nodes/tool/components/tool-form'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Loading from '@/app/components/base/loading'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'

const Panel: FC<NodePanelProps<PluginTriggerNodeType>> = ({
  id,
  data,
}) => {
  const {
    readOnly,
    currCollection,
    currTool,
    isShowAuthBtn,
    formSchemas,
    config,
    setConfig,
    hasPlugin,
  } = useConfig(id, data)

  if (!hasPlugin) {
    return (
      <div className='mt-2'>
        <div className='space-y-4 px-4 pb-2'>
          <Field title="Plugin Trigger">
            <div className="text-sm text-gray-500">
              No plugin selected. Configure this trigger in the workflow canvas.
            </div>
          </Field>
        </div>
      </div>
    )
  }

  if (!currCollection || !currTool) {
    return (
      <div className='flex h-[200px] items-center justify-center'>
        <Loading />
      </div>
    )
  }

  return (
    <div className='pt-2'>
      {!isShowAuthBtn && formSchemas.length > 0 && (
        <Field className='px-4' title="Configuration">
          <ToolForm
            readOnly={readOnly}
            nodeId={id}
            schema={formSchemas as any}
            value={config}
            onChange={setConfig}
            currentProvider={currCollection}
            currentTool={currTool}
          />
        </Field>
      )}

      <div>
        <OutputVars>
          <VarItem
            name='trigger_data'
            type='object'
            description='Data from plugin trigger'
          />
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
