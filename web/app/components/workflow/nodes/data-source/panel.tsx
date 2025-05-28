import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { memo } from 'react'
import { RiAddLine } from '@remixicon/react'
import type { DataSourceNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { BoxGroupField } from '@/app/components/workflow/nodes/_base/components/layout'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import TagInput from '@/app/components/base/tag-input'
import FieldList from '@/app/components/rag-pipeline/components/input-field/field-list/field-list-container'
import { useFieldList } from '@/app/components/rag-pipeline/components/input-field/field-list/hooks'
import InputFieldEditor from '@/app/components/rag-pipeline/components/input-field/editor'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { useConfig } from './hooks/use-config'
import { OUTPUT_VARIABLES_MAP } from './constants'
import ActionButton from '@/app/components/base/action-button'

const Panel: FC<NodePanelProps<DataSourceNodeType>> = ({ id, data }) => {
  const { t } = useTranslation()
  const { nodesReadOnly } = useNodesReadOnly()
  const {
    variables,
    provider_type,
    fileExtensions = [],
  } = data
  const {
    handleInputFieldVariablesChange,
    handleFileExtensionsChange,
  } = useConfig(id)
  const isLocalFile = provider_type === 'local_file'
  const {
    inputFields,
    handleListSortChange,
    handleRemoveField,
    handleOpenInputFieldEditor,
    showInputFieldEditor,
    editingField,
    handleSubmitField,
    handleCancelInputFieldEditor,
  } = useFieldList(variables, handleInputFieldVariablesChange, id)

  return (
    <div >
      {
        !isLocalFile && (
          <BoxGroupField
            boxGroupProps={{
              boxProps: { withBorderBottom: true },
            }}
            fieldProps={{
              fieldTitleProps: {
                title: t('workflow.nodes.common.inputVars'),
                operation: (
                  <ActionButton
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenInputFieldEditor()
                    }}
                  >
                    <RiAddLine className='h-4 w-4' />
                  </ActionButton>
                ),
              },
              supportCollapse: true,
            }}
          >
            <FieldList
              inputFields={inputFields}
              readonly={nodesReadOnly}
              onListSortChange={handleListSortChange}
              onRemoveField={handleRemoveField}
              onEditField={handleOpenInputFieldEditor}
            />
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
              />
            </div>
          </BoxGroupField>
        )
      }
      <OutputVars>
        <VarItem
          name={OUTPUT_VARIABLES_MAP.datasource_type.name}
          type={OUTPUT_VARIABLES_MAP.datasource_type.type}
          description={OUTPUT_VARIABLES_MAP.datasource_type.description}
        />
        {
          isLocalFile && (
            <VarItem
              name={OUTPUT_VARIABLES_MAP.file.name}
              type={OUTPUT_VARIABLES_MAP.file.type}
              description={OUTPUT_VARIABLES_MAP.file.description}
              subItems={OUTPUT_VARIABLES_MAP.file.subItems.map(item => ({
                name: item.name,
                type: item.type,
                description: item.description,
              }))}
            />
          )
        }
      </OutputVars>
      {showInputFieldEditor && (
        <InputFieldEditor
          show={showInputFieldEditor}
          initialData={editingField}
          onSubmit={handleSubmitField}
          onClose={handleCancelInputFieldEditor}
        />
      )}
    </div>
  )
}

export default memo(Panel)
