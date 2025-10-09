import {
  memo,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useStore } from '@/app/components/workflow/store'
import { RiCloseLine, RiEyeLine } from '@remixicon/react'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import FieldList from './field-list'
import FooterTip from './footer-tip'
import GlobalInputs from './label-right-content/global-inputs'
import Datasource from './label-right-content/datasource'
import { useNodes } from 'reactflow'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useTranslation } from 'react-i18next'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks'
import type { InputVar, RAGPipelineVariables } from '@/models/pipeline'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks'

const InputFieldPanel = () => {
  const { t } = useTranslation()
  const nodes = useNodes<DataSourceNodeType>()
  const {
    closeAllInputFieldPanels,
    toggleInputFieldPreviewPanel,
    isPreviewing,
    isEditing,
  } = useInputFieldPanel()
  const ragPipelineVariables = useStore(state => state.ragPipelineVariables)
  const setRagPipelineVariables = useStore(state => state.setRagPipelineVariables)

  const getInputFieldsMap = () => {
    const inputFieldsMap: Record<string, InputVar[]> = {}
    ragPipelineVariables?.forEach((variable) => {
      const { belong_to_node_id: nodeId, ...varConfig } = variable
      if (inputFieldsMap[nodeId])
        inputFieldsMap[nodeId].push(varConfig)
      else
        inputFieldsMap[nodeId] = [varConfig]
    })
    return inputFieldsMap
  }
  const inputFieldsMap = useRef(getInputFieldsMap())

  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const datasourceNodeDataMap = useMemo(() => {
    const datasourceNodeDataMap: Record<string, DataSourceNodeType> = {}
    const datasourceNodes: Node<DataSourceNodeType>[] = nodes.filter(node => node.data.type === BlockEnum.DataSource)
    datasourceNodes.forEach((node) => {
      const { id, data } = node
      datasourceNodeDataMap[id] = data
    })
    return datasourceNodeDataMap
  }, [nodes])

  const updateInputFields = useCallback(async (key: string, value: InputVar[]) => {
    inputFieldsMap.current[key] = value
    const datasourceNodeInputFields: RAGPipelineVariables = []
    const globalInputFields: RAGPipelineVariables = []
    Object.keys(inputFieldsMap.current).forEach((key) => {
      const inputFields = inputFieldsMap.current[key]
      inputFields.forEach((inputField) => {
        if (key === 'shared') {
          globalInputFields.push({
            ...inputField,
            belong_to_node_id: key,
          })
        }
        else {
          datasourceNodeInputFields.push({
            ...inputField,
            belong_to_node_id: key,
          })
        }
      })
    })
    // Datasource node input fields come first, then global input fields
    const newRagPipelineVariables = [...datasourceNodeInputFields, ...globalInputFields]
    setRagPipelineVariables?.(newRagPipelineVariables)
    handleSyncWorkflowDraft()
  }, [setRagPipelineVariables, handleSyncWorkflowDraft])

  const closePanel = useCallback(() => {
    closeAllInputFieldPanels()
  }, [closeAllInputFieldPanels])

  const togglePreviewPanel = useCallback(() => {
    toggleInputFieldPreviewPanel()
  }, [toggleInputFieldPreviewPanel])

  const allVariableNames = useMemo(() => {
    return ragPipelineVariables?.map(variable => variable.variable) || []
  }, [ragPipelineVariables])

  return (
    <div className='mr-1 flex h-full w-[400px] flex-col rounded-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border bg-components-panel-bg-alt shadow-xl shadow-shadow-shadow-5'>
      <div className='flex shrink-0 items-center p-4 pb-0'>
        <div className='system-xl-semibold grow text-text-primary'>
          {t('datasetPipeline.inputFieldPanel.title')}
        </div>
        <Button
          variant={'ghost'}
          size='small'
          className={cn(
            'shrink-0 gap-x-px px-1.5',
            isPreviewing && 'bg-state-accent-active text-text-accent',
          )}
          onClick={togglePreviewPanel}
          disabled={isEditing}
        >
          <RiEyeLine className='size-3.5' />
          <span className='px-[3px]'>{t('datasetPipeline.operations.preview')}</span>
        </Button>
        <Divider type='vertical' className='mx-1 h-3' />
        <button
          type='button'
          className='flex size-6 shrink-0 items-center justify-center p-0.5'
          onClick={closePanel}
        >
          <RiCloseLine className='size-4 text-text-tertiary' />
        </button>
      </div>
      <div className='system-sm-regular shrink-0 px-4 pb-2 pt-1 text-text-tertiary'>
        {t('datasetPipeline.inputFieldPanel.description')}
      </div>
      <div className='flex grow flex-col overflow-y-auto'>
        {/* Unique Inputs for Each Entrance */}
        <div className='flex h-6 items-center gap-x-0.5 px-4 pt-2'>
          <span className='system-sm-semibold-uppercase text-text-secondary'>
            {t('datasetPipeline.inputFieldPanel.uniqueInputs.title')}
          </span>
          <Tooltip
            popupContent={t('datasetPipeline.inputFieldPanel.uniqueInputs.tooltip')}
            popupClassName='max-w-[240px]'
          />
        </div>
        <div className='flex flex-col gap-y-1 py-1'>
          {
            Object.keys(datasourceNodeDataMap).map((key) => {
              const inputFields = inputFieldsMap.current[key] || []
              return (
                <FieldList
                  key={key}
                  nodeId={key}
                  LabelRightContent={<Datasource nodeData={datasourceNodeDataMap[key]} />}
                  inputFields={inputFields}
                  readonly={isPreviewing || isEditing}
                  labelClassName='pt-1 pb-1'
                  handleInputFieldsChange={updateInputFields}
                  allVariableNames={allVariableNames}
                />
              )
            })
          }
        </div>
        {/* Global Inputs */}
        <FieldList
          nodeId='shared'
          LabelRightContent={<GlobalInputs />}
          inputFields={inputFieldsMap.current.shared || []}
          readonly={isPreviewing || isEditing}
          labelClassName='pt-2 pb-1'
          handleInputFieldsChange={updateInputFields}
          allVariableNames={allVariableNames}
        />
      </div>
      <FooterTip />
    </div>
  )
}

export default memo(InputFieldPanel)
