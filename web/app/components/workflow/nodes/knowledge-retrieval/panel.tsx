import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import RetrievalConfig from './components/retrieval-config'
import AddKnowledge from './components/add-dataset'
import DatasetList from './components/dataset-list'
import type { KnowledgeRetrievalNodeType } from './types'
import AddMetadataFilter from './components/add-metadata-filter'
import MetadataFilterModes from './components/metadata-filter-modes'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import type { NodePanelProps, Var } from '@/app/components/workflow/types'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import HelpCircle from '@/app/components/base/icons/src/vender/line/general/HelpCircle'

const i18nPrefix = 'workflow.nodes.knowledgeRetrieval'

const Panel: FC<NodePanelProps<KnowledgeRetrievalNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const arrayStringfilterVar = React.useCallback((varPayload: Var) => {
    return varPayload.type === VarType.arrayString
  }, [])

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
    handleOnDatasetsChange,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    query,
    setQuery,
    runResult,
    handleAuthorizedDatasetIdsChange,
    selectedFilterModes,
    addFilterModePanel,
    handleFilterModeToMetadataFilterConfigDictChange,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        {/* {JSON.stringify(inputs, null, 2)} */}
        <Field
          title={t(`${i18nPrefix}.queryVariable`)}
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
                readonly={readOnly}
              />
              {!readOnly && (<div className='w-px h-3 bg-gray-200'></div>)}
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

        <Field
          title={<>
            {t(`${i18nPrefix}.dynamicKnowledge`)}
            {
              <TooltipPlus popupContent={
                <div className='w-[470px]'>
                  {t(`${i18nPrefix}.dynamicKnowledgeTip`)}
                </div>}>
                <HelpCircle className='w-3.5 h-3.5 ml-0.5 text-gray-400' />
              </TooltipPlus>
            }
          </>}
        >
          <VarReferencePicker
            nodeId={id}
            readonly={readOnly}
            isShowNodeName
            value={inputs.authorized_dataset_ids_variable_selector ? inputs.authorized_dataset_ids_variable_selector : []}
            onChange={handleAuthorizedDatasetIdsChange}
            filterVar={arrayStringfilterVar}
          />
        </Field>

        <Field
          title={<>
            {t(`${i18nPrefix}.metadataFilter`)}
            {
              <TooltipPlus popupContent={
                <div className='w-[270]'>
                  {t(`${i18nPrefix}.metadataFilterTip`)}
                </div>}>
                <HelpCircle className='w-3.5 h-3.5 ml-0.5 text-gray-400' />
              </TooltipPlus>
            }
          </>}

          operations={
            <AddMetadataFilter readonly={readOnly} selectedKeys={selectedFilterModes} onSelect={addFilterModePanel} />
          }
        >
          <MetadataFilterModes
            value={inputs.filter_mode_to_metadata_filter_config_dict}
            onChange={handleFilterModeToMetadataFilterConfigDictChange}
            readonly={readOnly}
            nodeId={id}
          />
        </Field>

      </div>

      <Split />
      <div className='px-4 pt-4 pb-2'>
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
                onChange: keyValue => setQuery((keyValue as any).query),
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

export default React.memo(Panel)
