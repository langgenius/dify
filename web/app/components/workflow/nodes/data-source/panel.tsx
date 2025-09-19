import type { FC } from 'react'
import {
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { memo } from 'react'
import type { DataSourceNodeType } from './types'
import { DataSourceClassification } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  BoxGroupField,
} from '@/app/components/workflow/nodes/_base/components/layout'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import StructureOutputItem from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import TagInput from '@/app/components/base/tag-input'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { useConfig } from './hooks/use-config'
import {
  COMMON_OUTPUT,
  LOCAL_FILE_OUTPUT,
} from './constants'
import { useStore } from '@/app/components/workflow/store'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import ToolForm from '../tool/components/tool-form'
import { wrapStructuredVarItem } from '@/app/components/workflow/utils/tool'
import useMatchSchemaType, { getMatchedSchemaType } from '../_base/components/variable/use-match-schema-type'

const Panel: FC<NodePanelProps<DataSourceNodeType>> = ({ id, data }) => {
  const { t } = useTranslation()
  const { nodesReadOnly } = useNodesReadOnly()
  const dataSourceList = useStore(s => s.dataSourceList)
  const {
    provider_type,
    plugin_id,
    fileExtensions = [],
    datasource_parameters,
  } = data
  const {
    handleFileExtensionsChange,
    handleParametersChange,
    outputSchema,
    hasObjectOutput,
  } = useConfig(id, dataSourceList)
  const isLocalFile = provider_type === DataSourceClassification.localFile
  const currentDataSource = dataSourceList?.find(ds => ds.plugin_id === plugin_id)
  const currentDataSourceItem: any = currentDataSource?.tools?.find((tool: any) => tool.name === data.datasource_name)
  const formSchemas = useMemo(() => {
    return currentDataSourceItem ? toolParametersToFormSchemas(currentDataSourceItem.parameters) : []
  }, [currentDataSourceItem])

  const pipelineId = useStore(s => s.pipelineId)
  const setShowInputFieldPanel = useStore(s => s.setShowInputFieldPanel)
  const { schemaTypeDefinitions } = useMatchSchemaType()
  return (
    <div >
      {
        currentDataSource?.is_authorized && !isLocalFile && !!formSchemas?.length && (
          <BoxGroupField
            boxGroupProps={{
              boxProps: { withBorderBottom: true },
            }}
            fieldProps={{
              fieldTitleProps: {
                title: t('workflow.nodes.tool.inputVars'),
              },
              supportCollapse: true,
            }}
          >
            {formSchemas.length > 0 && (
              <ToolForm
                readOnly={nodesReadOnly}
                nodeId={id}
                schema={formSchemas as any}
                value={datasource_parameters}
                onChange={handleParametersChange}
                currentProvider={currentDataSource}
                currentTool={currentDataSourceItem}
                showManageInputField={!!pipelineId}
                onManageInputField={() => setShowInputFieldPanel?.(true)}
              />
            )}
          </BoxGroupField>
        )
      }
      {
        isLocalFile && (
          <BoxGroupField
            boxGroupProps={{
              boxProps: { withBorderBottom: true },
            }}
            fieldProps={{
              fieldTitleProps: {
                title: t('workflow.nodes.dataSource.supportedFileFormats'),
              },
            }}
          >
            <div className='rounded-lg bg-components-input-bg-normal p-1 pt-0'>
              <TagInput
                items={fileExtensions}
                onChange={handleFileExtensionsChange}
                placeholder={t('workflow.nodes.dataSource.supportedFileFormatsPlaceholder')}
                inputClassName='bg-transparent'
                disableAdd={nodesReadOnly}
                disableRemove={nodesReadOnly}
              />
            </div>
          </BoxGroupField>
        )
      }
      <OutputVars>
        {
          COMMON_OUTPUT.map((item, index) => (
            <VarItem
              key={index}
              name={item.name}
              type={item.type}
              description={item.description}
              isIndent={hasObjectOutput}
            />
          ))
        }
        {
          isLocalFile && LOCAL_FILE_OUTPUT.map((item, index) => (
            <VarItem
              key={index}
              name={item.name}
              type={item.type}
              description={item.description}
              subItems={item.subItems.map(item => ({
                name: item.name,
                type: item.type,
                description: item.description,
              }))}
            />
          ))
        }
        {outputSchema.map((outputItem) => {
          const schemaType = getMatchedSchemaType(outputItem.value, schemaTypeDefinitions)

          return (
            <div key={outputItem.name}>
              {outputItem.value?.type === 'object' ? (
                <StructureOutputItem
                  rootClassName='code-sm-semibold text-text-secondary'
                  payload={wrapStructuredVarItem(outputItem, schemaType)}
                />
              ) : (
                <VarItem
                  name={outputItem.name}
                  // eslint-disable-next-line sonarjs/no-nested-template-literals
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
