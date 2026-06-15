import type { FC } from 'react'
import type { PluginTriggerNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import StructureOutputItem from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { BlockEnum } from '@/app/components/workflow/types'
import { Type } from '../llm/types'
import TriggerForm from './components/trigger-form'
import useConfig from './use-config'

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
    currentProvider,
    currentEvent,
    subscriptionSelected,
  } = useConfig(id, data)
  const disableVariableInsertion = data.type === BlockEnum.TriggerPlugin

  // Convert output schema to VarItem format
  const outputVars = Object.entries(outputSchema.properties || {}).map(([name, schema]: [string, any]) => ({
    name,
    type: schema.type || 'string',
    description: schema.description || '',
  }))

  return (
    <div className="mt-2">
      {/* Dynamic Parameters Form - Only show when authenticated */}
      {triggerParameterSchema.length > 0 && subscriptionSelected && (
        <>
          <div className="px-4 pb-4">
            <TriggerForm
              readOnly={readOnly}
              nodeId={id}
              schema={triggerParameterSchema as any}
              value={triggerParameterValue}
              onChange={setTriggerParameterValue}
              currentProvider={currentProvider}
              currentEvent={currentEvent}
              disableVariableInsertion={disableVariableInsertion}
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
              {schema.type === 'object'
                ? (
                    <StructureOutputItem
                      rootClassName="code-sm-semibold text-text-secondary"
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
                  )
                : null}
            </div>
          ))}
        </>
      </OutputVars>
    </div>
  )
}

export default React.memo(Panel)
