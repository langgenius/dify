import type { FC } from 'react'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import RetrievalConfig from './components/retrieval-config'
import AddKnowledge from './components/add-dataset'
import DatasetList from './components/dataset-list'
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
  } = useConfig(id, data)

  const handleOpenFromPropsChange = useCallback((openFromProps: boolean) => {
    setRerankModelOpen(openFromProps)
  }, [setRerankModelOpen])

  return (
    <div className='pt-2'>
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
                readonly={readOnly || !selectedDatasets.length}
                openFromProps={rerankModelOpen}
                onOpenFromPropsChange={handleOpenFromPropsChange}
                selectedDatasets={selectedDatasets}
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

export default memo(Panel)
