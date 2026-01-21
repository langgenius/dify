import type { FC } from 'react'
import type { ToolNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import StructureOutputItem from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { useStore } from '@/app/components/workflow/store'
import { wrapStructuredVarItem } from '@/app/components/workflow/utils/tool'
import Split from '../_base/components/split'
import useMatchSchemaType, { getMatchedSchemaType } from '../_base/components/variable/use-match-schema-type'
import ToolForm from './components/tool-form'
import useConfig from './use-config'

const i18nPrefix = 'nodes.tool'

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
  const pipelineId = useStore(s => s.pipelineId)
  const setShowInputFieldPanel = useStore(s => s.setShowInputFieldPanel)
  const { schemaTypeDefinitions } = useMatchSchemaType()

  if (isLoading) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <Loading />
      </div>
    )
  }

  return (
    <div className="pt-2">
      {!isShowAuthBtn && (
        <div className="relative">
          {toolInputVarSchema.length > 0 && (
            <Field
              className="px-4"
              title={t(`${i18nPrefix}.inputVars`, { ns: 'workflow' })}
            >
              <ToolForm
                readOnly={readOnly}
                nodeId={id}
                schema={toolInputVarSchema as any}
                value={inputs.tool_parameters}
                onChange={setInputVar}
                currentProvider={currCollection}
                currentTool={currTool}
                showManageInputField={!!pipelineId}
                onManageInputField={() => setShowInputFieldPanel?.(true)}
              />
            </Field>
          )}

          {toolInputVarSchema.length > 0 && toolSettingSchema.length > 0 && (
            <Split className="mt-1" />
          )}

          {toolSettingSchema.length > 0 && (
            <>
              <OutputVars
                title={t(`${i18nPrefix}.settings`, { ns: 'workflow' })}
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
              name="text"
              type="string"
              description={t(`${i18nPrefix}.outputVars.text`, { ns: 'workflow' })}
              isIndent={hasObjectOutput}
            />
            <VarItem
              name="files"
              type="array[file]"
              description={t(`${i18nPrefix}.outputVars.files.title`, { ns: 'workflow' })}
              isIndent={hasObjectOutput}
            />
            <VarItem
              name="json"
              type="array[object]"
              description={t(`${i18nPrefix}.outputVars.json`, { ns: 'workflow' })}
              isIndent={hasObjectOutput}
            />
            {outputSchema.map((outputItem) => {
              const schemaType = getMatchedSchemaType(outputItem.value, schemaTypeDefinitions)
              // TODO empty object type always match `qa_structured` schema type
              return (
                <div key={outputItem.name}>
                  {outputItem.value?.type === 'object'
                    ? (
                        <StructureOutputItem
                          rootClassName="code-sm-semibold text-text-secondary"
                          payload={wrapStructuredVarItem(outputItem, schemaType)}
                        />
                      )
                    : (
                        <VarItem
                          name={outputItem.name}

                          type={`${outputItem.type.toLocaleLowerCase()}${schemaType ? ` (${schemaType})` : ''}`}
                          description={outputItem.description}
                          isIndent={hasObjectOutput}
                        />
                      )}
                </div>
              )
            })}
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
