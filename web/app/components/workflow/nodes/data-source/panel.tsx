import type { FC } from 'react'
import type { DataSourceNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import TagInput from '@/app/components/base/tag-input'
import { BoxGroupField } from '@/app/components/workflow/nodes/_base/components/layout'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import StructureOutputItem from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { useStore } from '@/app/components/workflow/store'
import { datasourceParametersToFormSchemas } from '@/app/components/workflow/utils/data-source'
import { matchDataSource } from '@/app/components/workflow/utils/plugin-install-check'
import { useNodesReadOnly } from '../../hooks/use-workflow'
import useMatchSchemaType, {
  getMatchedSchemaType,
} from '../_base/components/variable/use-match-schema-type'
import ToolForm from '../tool/components/tool-form'
import { COMMON_OUTPUT, LOCAL_FILE_OUTPUT } from './constants'
import { useConfig } from './hooks/use-config'
import { DataSourceClassification } from './types'

const Panel: FC<NodePanelProps<DataSourceNodeType>> = ({ id, data }) => {
  const { t } = useTranslation(['workflow'])
  const { nodesReadOnly } = useNodesReadOnly()
  const dataSourceList = useStore((s) => s.dataSourceList)
  const { provider_type, fileExtensions = [], datasource_parameters } = data
  const { handleFileExtensionsChange, handleParametersChange, outputSchema, hasObjectOutput } =
    useConfig(id, data, dataSourceList)
  const isLocalFile = provider_type === DataSourceClassification.localFile
  const currentDataSource = matchDataSource(dataSourceList ?? [], data)
  const currentDataSourceItem = currentDataSource?.declaration.datasources?.find(
    (item) => item.identity.name === data.datasource_name,
  )
  const formSchemas = useMemo(
    () => datasourceParametersToFormSchemas(currentDataSourceItem?.parameters),
    [currentDataSourceItem],
  )

  const pipelineId = useStore((s) => s.pipelineId)
  const setShowInputFieldPanel = useStore((s) => s.setShowInputFieldPanel)
  const { schemaTypeDefinitions } = useMatchSchemaType()
  return (
    <div>
      {currentDataSource?.is_authorized && !isLocalFile && !!formSchemas?.length && (
        <BoxGroupField
          boxGroupProps={{
            boxProps: { withBorderBottom: true },
          }}
          fieldProps={{
            fieldTitleProps: {
              title: t(($) => $['nodes.tool.inputVars'], { ns: 'workflow' }),
            },
            supportCollapse: true,
          }}
        >
          {formSchemas.length > 0 && (
            <ToolForm
              readOnly={nodesReadOnly}
              nodeId={id}
              schema={formSchemas}
              staticSchema
              value={datasource_parameters}
              onChange={handleParametersChange}
              showManageInputField={!!pipelineId}
              onManageInputField={() => setShowInputFieldPanel?.(true)}
            />
          )}
        </BoxGroupField>
      )}
      {isLocalFile && (
        <BoxGroupField
          boxGroupProps={{
            boxProps: { withBorderBottom: true },
          }}
          fieldProps={{
            fieldTitleProps: {
              title: t(($) => $['nodes.dataSource.supportedFileFormats'], { ns: 'workflow' }),
            },
          }}
        >
          <div className="rounded-lg bg-components-input-bg-normal p-1 pt-0">
            <TagInput
              items={fileExtensions}
              onChange={handleFileExtensionsChange}
              placeholder={t(($) => $['nodes.dataSource.supportedFileFormatsPlaceholder'], {
                ns: 'workflow',
              })}
              inputClassName="bg-transparent"
              disableAdd={nodesReadOnly}
              disableRemove={nodesReadOnly}
            />
          </div>
        </BoxGroupField>
      )}
      <OutputVars>
        {COMMON_OUTPUT.map((item, index) => (
          <VarItem
            key={index}
            name={item.name}
            type={item.type}
            description={item.description}
            isIndent={hasObjectOutput}
          />
        ))}
        {isLocalFile &&
          LOCAL_FILE_OUTPUT.map((item, index) => (
            <VarItem
              key={index}
              name={item.name}
              type={item.type}
              description={item.description}
              subItems={item.subItems.map((item) => ({
                name: item.name,
                type: item.type,
                description: item.description,
              }))}
            />
          ))}
        {outputSchema.map((outputItem) => {
          const schema =
            outputItem.value &&
            typeof outputItem.value === 'object' &&
            !Array.isArray(outputItem.value)
              ? outputItem.value
              : {}
          const schemaType = getMatchedSchemaType(schema, schemaTypeDefinitions)

          return (
            <div key={outputItem.name}>
              {outputItem.isObject ? (
                <StructureOutputItem
                  rootClassName="code-sm-semibold text-text-secondary"
                  payload={{
                    schema: { properties: { [outputItem.name]: { ...schema, schemaType } } },
                  }}
                />
              ) : (
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
      </OutputVars>
    </div>
  )
}

export default memo(Panel)
