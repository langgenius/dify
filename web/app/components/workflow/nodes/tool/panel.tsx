import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Split from '../_base/components/split'
import type { ToolNodeType } from './types'
import useConfig from './use-config'
import ToolForm from './components/tool-form'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Loading from '@/app/components/base/loading'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import StructureOutputItem from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { Type } from '../llm/types'

const i18nPrefix = 'workflow.nodes.tool'

const Panel: FC<NodePanelProps<ToolNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    toolInputVarSchema,
    setInputVar,
    toolSettingSchema,
    toolSettingValue,
    setToolSettingValue,
    currCollection,
    isShowAuthBtn,
    isLoading,
    outputSchema,
    hasObjectOutput,
    currTool,
  } = useConfig(id, data)

  const [collapsed, setCollapsed] = React.useState(false)

  if (isLoading) {
    return <div className='flex h-[200px] items-center justify-center'>
      <Loading />
    </div>
  }

  return (
    <div className='pt-2'>
      {!isShowAuthBtn && (
        <div className='relative'>
          {toolInputVarSchema.length > 0 && (
            <Field
              className='px-4'
              title={t(`${i18nPrefix}.inputVars`)}
            >
              <ToolForm
                readOnly={readOnly}
                nodeId={id}
                schema={toolInputVarSchema as any}
                value={inputs.tool_parameters}
                onChange={setInputVar}
                currentProvider={currCollection}
                currentTool={currTool}
              />
            </Field>
          )}

          {toolInputVarSchema.length > 0 && toolSettingSchema.length > 0 && (
            <Split className='mt-1' />
          )}

          {toolSettingSchema.length > 0 && (
            <>
              <OutputVars
                title={t(`${i18nPrefix}.settings`)}
                collapsed={collapsed}
                onCollapse={setCollapsed}
              >
                <ToolForm
                  readOnly={readOnly}
                  nodeId={id}
                  schema={toolSettingSchema as any}
                  value={toolSettingValue}
                  onChange={setToolSettingValue}
                />
              </OutputVars>
              <Split />
            </>
          )}
        </div>
      )}

      <div>
        <OutputVars>
          <>
            <VarItem
              name='text'
              type='string'
              description={t(`${i18nPrefix}.outputVars.text`)}
              isIndent={hasObjectOutput}
            />
            <VarItem
              name='files'
              type='array[file]'
              description={t(`${i18nPrefix}.outputVars.files.title`)}
              isIndent={hasObjectOutput}
            />
            <VarItem
              name='json'
              type='array[object]'
              description={t(`${i18nPrefix}.outputVars.json`)}
              isIndent={hasObjectOutput}
            />
            {outputSchema.map(outputItem => (
              <div key={outputItem.name}>
                {outputItem.value?.type === 'object' ? (
                  <StructureOutputItem
                    rootClassName='code-sm-semibold text-text-secondary'
                    payload={{
                      schema: {
                        type: Type.object,
                        properties: {
                          [outputItem.name]: outputItem.value,
                        },
                        additionalProperties: false,
                      },
                    }} />
                ) : (
                  <VarItem
                    name={outputItem.name}
                    type={outputItem.type.toLocaleLowerCase()}
                    description={outputItem.description}
                    isIndent={hasObjectOutput}
                  />
                )}
              </div>
            ))}
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
