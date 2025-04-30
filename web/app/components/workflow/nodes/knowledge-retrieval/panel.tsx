import type { FC } from 'react'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { intersectionBy } from 'lodash-es'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import RetrievalConfig from './components/retrieval-config'
import AddKnowledge from './components/add-dataset'
import DatasetList from './components/dataset-list'
import MetadataFilter from './components/metadata/metadata-filter'
import type { KnowledgeRetrievalNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import { InputVarType, type NodePanelProps } from '@/app/components/workflow/types'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import ResultPanel from '@/app/components/workflow/run/result-panel'

const i18nPrefix = 'workflow.nodes.knowledgeRetrieval'

const Panel: FC<NodePanelProps<KnowledgeRetrievalNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleQueryVarChange,
    filterVar,
    handleModelChanged,
    handleCompletionParamsChange,
    handleRetrievalModeChange,
    handleMultipleRetrievalConfigChange,
    selectedDatasets,
    selectedDatasetsLoaded,
    handleOnDatasetsChange,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    query,
    setQuery,
    runResult,
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
  } = useConfig(id, data)

  const handleOpenFromPropsChange = useCallback((openFromProps: boolean) => {
    setRerankModelOpen(openFromProps)
  }, [setRerankModelOpen])

  const metadataList = useMemo(() => {
    return intersectionBy(...selectedDatasets.filter((dataset) => {
      return !!dataset.doc_metadata
    }).map((dataset) => {
      return dataset.doc_metadata!
    }), 'name')
  }, [selectedDatasets])

  return (
    <div className='pt-2'>
      <div className='space-y-4 px-4 pb-2'>
        {/* {JSON.stringify(inputs, null, 2)} */}
        <Field
          title={t(`${i18nPrefix}.queryVariable`)}
          required
        >
          <VarReferencePicker
            nodeId={id}
            readonly={readOnly}
            isShowNodeName
            value={inputs.query_variable_selector}
            onChange={handleQueryVarChange}
            filterVar={filterVar}
          />
        </Field>

        <Field
          title={t(`${i18nPrefix}.knowledge`)}
          required
          operations={
            <div className='flex items-center space-x-1'>
              <RetrievalConfig
                payload={{
                  retrieval_mode: inputs.retrieval_mode,
                  multiple_retrieval_config: inputs.multiple_retrieval_config,
                  single_retrieval_config: inputs.single_retrieval_config,
                }}
                onRetrievalModeChange={handleRetrievalModeChange}
                onMultipleRetrievalConfigChange={handleMultipleRetrievalConfigChange}
                singleRetrievalModelConfig={inputs.single_retrieval_config?.model}
                onSingleRetrievalModelChange={handleModelChanged as any}
                onSingleRetrievalModelParamsChange={handleCompletionParamsChange}
                readonly={readOnly || !selectedDatasets.length}
                openFromProps={rerankModelOpen}
                onOpenFromPropsChange={handleOpenFromPropsChange}
                selectedDatasets={selectedDatasets}
              />
              {!readOnly && (<div className='h-3 w-px bg-divider-regular'></div>)}
              {!readOnly && (
                <AddKnowledge
                  selectedIds={inputs.dataset_ids}
                  onChange={handleOnDatasetsChange}
                />
              )}
            </div>
          }
        >
          <DatasetList
            list={selectedDatasets}
            onChange={handleOnDatasetsChange}
            readonly={readOnly}
          />
        </Field>
      </div>
      <div className='mb-2 py-2'>
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
              name='result'
              type='Array[Object]'
              description={t(`${i18nPrefix}.outputVars.output`)}
              subItems={[
                {
                  name: 'content',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.content`),
                },
                // url, title, link like bing search reference result: link, link page title, link page icon
                {
                  name: 'title',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.title`),
                },
                {
                  name: 'url',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.url`),
                },
                {
                  name: 'icon',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.icon`),
                },
                {
                  name: 'metadata',
                  type: 'object',
                  description: t(`${i18nPrefix}.outputVars.metadata`),
                },
              ]}
            />

          </>
        </OutputVars>
        {isShowSingleRun && (
          <BeforeRunForm
            nodeName={inputs.title}
            onHide={hideSingleRun}
            forms={[
              {
                inputs: [{
                  label: t(`${i18nPrefix}.queryVariable`)!,
                  variable: 'query',
                  type: InputVarType.paragraph,
                  required: true,
                }],
                values: { query },
                onChange: keyValue => setQuery(keyValue.query),
              },
            ]}
            runningStatus={runningStatus}
            onRun={handleRun}
            onStop={handleStop}
            result={<ResultPanel {...runResult} showSteps={false} />}
          />
        )}
      </div>
    </div>
  )
}

export default memo(Panel)
