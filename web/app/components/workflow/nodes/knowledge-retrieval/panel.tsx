import type { FC } from 'react'
import type { KnowledgeRetrievalNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { intersectionBy } from 'es-toolkit/compat'
import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import AddKnowledge from './components/add-dataset'
import DatasetList from './components/dataset-list'
import MetadataFilter from './components/metadata/metadata-filter'
import RetrievalConfig from './components/retrieval-config'
import useConfig from './use-config'

const i18nPrefix = 'nodes.knowledgeRetrieval'

const Panel: FC<NodePanelProps<KnowledgeRetrievalNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleQueryVarChange,
    handleQueryAttachmentChange,
    filterStringVar,
    filterFileVar,
    handleModelChanged,
    handleCompletionParamsChange,
    handleRetrievalModeChange,
    handleMultipleRetrievalConfigChange,
    selectedDatasets,
    selectedDatasetsLoaded,
    handleOnDatasetsChange,
    rerankModelOpen,
    setRerankModelOpen,
    handleAddCondition,
    handleMetadataFilterModeChange,
    handleRemoveCondition,
    handleToggleConditionLogicalOperator,
    handleUpdateCondition,
    handleMetadataModelChange,
    handleMetadataCompletionParamsChange,
    availableStringVars,
    availableStringNodesWithParent,
    availableNumberVars,
    availableNumberNodesWithParent,
    showImageQueryVarSelector,
  } = useConfig(id, data)

  const metadataList = useMemo(() => {
    return intersectionBy(...selectedDatasets.filter((dataset) => {
      return !!dataset.doc_metadata
    }).map((dataset) => {
      return dataset.doc_metadata!
    }), 'name')
  }, [selectedDatasets])

  return (
    <div className="pt-2">
      <div className="space-y-4 px-4 pb-2">
        <Field title={t(`${i18nPrefix}.queryText`, { ns: 'workflow' })}>
          <VarReferencePicker
            nodeId={id}
            readonly={readOnly}
            isShowNodeName
            value={inputs.query_variable_selector}
            onChange={handleQueryVarChange}
            filterVar={filterStringVar}
          />
        </Field>

        {showImageQueryVarSelector && (
          <Field title={t(`${i18nPrefix}.queryAttachment`, { ns: 'workflow' })}>
            <VarReferencePicker
              nodeId={id}
              readonly={readOnly}
              isShowNodeName
              value={inputs.query_attachment_selector}
              onChange={handleQueryAttachmentChange}
              filterVar={filterFileVar}
            />
          </Field>
        )}

        <Field
          title={t(`${i18nPrefix}.knowledge`, { ns: 'workflow' })}
          required
          operations={(
            <div className="flex items-center space-x-1">
              <RetrievalConfig
                payload={{
                  retrieval_mode: inputs.retrieval_mode,
                  multiple_retrieval_config: inputs.multiple_retrieval_config,
                  single_retrieval_config: inputs.single_retrieval_config,
                }}
                onRetrievalModeChange={handleRetrievalModeChange}
                onMultipleRetrievalConfigChange={handleMultipleRetrievalConfigChange}
                singleRetrievalModelConfig={inputs.single_retrieval_config?.model}
                onSingleRetrievalModelChange={handleModelChanged}
                onSingleRetrievalModelParamsChange={handleCompletionParamsChange}
                readonly={readOnly || !selectedDatasets.length}
                rerankModalOpen={rerankModelOpen}
                onRerankModelOpenChange={setRerankModelOpen}
                selectedDatasets={selectedDatasets}
              />
              {!readOnly && (<div className="h-3 w-px bg-divider-regular"></div>)}
              {!readOnly && (
                <AddKnowledge
                  selectedIds={inputs.dataset_ids}
                  onChange={handleOnDatasetsChange}
                />
              )}
            </div>
          )}
        >
          <DatasetList
            list={selectedDatasets}
            onChange={handleOnDatasetsChange}
            readonly={readOnly}
          />
        </Field>
      </div>
      <div className="mb-2 py-2">
        <MetadataFilter
          metadataList={metadataList}
          selectedDatasetsLoaded={selectedDatasetsLoaded}
          metadataFilterMode={inputs.metadata_filtering_mode}
          metadataFilteringConditions={inputs.metadata_filtering_conditions}
          handleAddCondition={handleAddCondition}
          handleMetadataFilterModeChange={handleMetadataFilterModeChange}
          handleRemoveCondition={handleRemoveCondition}
          handleToggleConditionLogicalOperator={handleToggleConditionLogicalOperator}
          handleUpdateCondition={handleUpdateCondition}
          metadataModelConfig={inputs.metadata_model_config}
          handleMetadataModelChange={handleMetadataModelChange}
          handleMetadataCompletionParamsChange={handleMetadataCompletionParamsChange}
          availableStringVars={availableStringVars}
          availableStringNodesWithParent={availableStringNodesWithParent}
          availableNumberVars={availableNumberVars}
          availableNumberNodesWithParent={availableNumberNodesWithParent}
        />
      </div>
      <Split />
      <div>
        <OutputVars>
          <>
            <VarItem
              name="result"
              type="Array[Object]"
              description={t(`${i18nPrefix}.outputVars.output`, { ns: 'workflow' })}
              subItems={[
                {
                  name: 'content',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.content`, { ns: 'workflow' }),
                },
                // url, title, link like bing search reference result: link, link page title, link page icon
                {
                  name: 'title',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.title`, { ns: 'workflow' }),
                },
                {
                  name: 'url',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.url`, { ns: 'workflow' }),
                },
                {
                  name: 'icon',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.icon`, { ns: 'workflow' }),
                },
                {
                  name: 'metadata',
                  type: 'object',
                  description: t(`${i18nPrefix}.outputVars.metadata`, { ns: 'workflow' }),
                },
                {
                  name: 'files',
                  type: 'Array[File]',
                  description: t(`${i18nPrefix}.outputVars.files`, { ns: 'workflow' }),
                },
              ]}
            />

          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default memo(Panel)
