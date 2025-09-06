import type { FC } from 'react'
import React from 'react'
import type { PluginTriggerNodeType } from './types'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import type { NodePanelProps } from '@/app/components/workflow/types'
import useConfig from './use-config'
import ToolForm from '@/app/components/workflow/nodes/tool/components/tool-form'
import StructureOutputItem from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { Type } from '../llm/types'

const Panel: FC<NodePanelProps<PluginTriggerNodeType>> = ({
  id,
  data,
}) => {
  const {
    readOnly,
    triggerParameterSchema,
    triggerParameterValue,
    setTriggerParameterValue,
    outputSchema,
    hasObjectOutput,
    isAuthenticated,
  } = useConfig(id, data)

  // Convert output schema to VarItem format
  const outputVars = Object.entries(outputSchema.properties || {}).map(([name, schema]: [string, any]) => ({
    name,
    type: schema.type || 'string',
    description: schema.description || '',
  }))

  return (
    <div className='mt-2'>
      {/* Dynamic Parameters Form - Only show when authenticated */}
      {isAuthenticated && triggerParameterSchema.length > 0 && (
        <>
          <div className='px-4 pb-4'>
            <ToolForm
              readOnly={readOnly}
              nodeId={id}
              schema={triggerParameterSchema as any}
              value={triggerParameterValue}
              onChange={setTriggerParameterValue}
            />
          </div>
          <Split />
        </>
      )}

      {/* Output Variables - Always show */}
      <OutputVars>
        <>
          {outputVars.map(varItem => (
            <VarItem
              key={varItem.name}
              name={varItem.name}
              type={varItem.type}
              description={varItem.description}
              isIndent={hasObjectOutput}
            />
          ))}
          {Object.entries(outputSchema.properties || {}).map(([name, schema]: [string, any]) => (
            <div key={name}>
              {schema.type === 'object' ? (
                <StructureOutputItem
                  rootClassName='code-sm-semibold text-text-secondary'
                  payload={{
                    schema: {
                      type: Type.object,
                      properties: {
                        [name]: schema,
                      },
                      additionalProperties: false,
                    },
                  }}
                />
              ) : null}
            </div>
          ))}
        </>
      </OutputVars>
    </div>
  )
}

export default React.memo(Panel)
