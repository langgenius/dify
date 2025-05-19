import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useStore } from '@/app/components/workflow/store'
import { RiCloseLine } from '@remixicon/react'
import { BlockEnum } from '@/app/components/workflow/types'
import DialogWrapper from './dialog-wrapper'
import FieldList from './field-list'
import FooterTip from './footer-tip'
import SharedInputs from './label-right-content/shared-inputs'
import Datasource from './label-right-content/datasource'
import { useNodes } from 'reactflow'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { useNodesSyncDraft } from '../../hooks'
import type { InputVar, RAGPipelineVariables } from '@/models/pipeline'

type InputFieldDialogProps = {
  readonly?: boolean
}

const InputFieldDialog = ({
  readonly = false,
}: InputFieldDialogProps) => {
  const { t } = useTranslation()
  const nodes = useNodes<DataSourceNodeType>()
  const showInputFieldDialog = useStore(state => state.showInputFieldDialog)
  const setShowInputFieldDialog = useStore(state => state.setShowInputFieldDialog)
  const ragPipelineVariables = useStore(state => state.ragPipelineVariables)
  const setRagPipelineVariables = useStore(state => state.setRagPipelineVariables)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

  const datasourceTitleMap = useMemo(() => {
    const datasourceNameMap: Record<string, string> = {}
    const datasourceNodes = nodes.filter(node => node.data.type === BlockEnum.DataSource)
    datasourceNodes.forEach((node) => {
      const { id, data } = node
      if (data?.title)
        datasourceNameMap[id] = data.title
    })
    return datasourceNameMap
  }, [nodes])

  const inputFieldsMap = useMemo(() => {
    const inputFieldsMap: Record<string, InputVar[]> = {}
    ragPipelineVariables?.forEach((variable) => {
      const { belong_to_node_id: nodeId, ...varConfig } = variable
      if (inputFieldsMap[nodeId])
        inputFieldsMap[nodeId].push(varConfig)
      else
        inputFieldsMap[nodeId] = [varConfig]
    })
    return inputFieldsMap
  }, [ragPipelineVariables])

  const datasourceKeys = useMemo(() => {
    return Object.keys(inputFieldsMap).filter(key => key !== 'shared')
  }, [inputFieldsMap])

  const updateInputFields = useCallback(async (key: string, value: InputVar[]) => {
    const NewInputFieldsMap = produce(inputFieldsMap, (draft) => {
      draft[key] = value
    })
    const newRagPipelineVariables: RAGPipelineVariables = []
    Object.keys(NewInputFieldsMap).forEach((key) => {
      const inputFields = NewInputFieldsMap[key]
      inputFields.forEach((inputField) => {
        newRagPipelineVariables.push({
          ...inputField,
          belong_to_node_id: key,
        })
      })
    })
    setRagPipelineVariables?.(newRagPipelineVariables)
    await doSyncWorkflowDraft()
  }, [doSyncWorkflowDraft, inputFieldsMap, setRagPipelineVariables])

  const closePanel = useCallback(() => {
    setShowInputFieldDialog?.(false)
  }, [setShowInputFieldDialog])

  return (
    <DialogWrapper
      show={!!showInputFieldDialog}
      onClose={closePanel}
    >
      <div className='flex grow flex-col'>
        <div className='flex items-center p-4 pb-0'>
          <div className='system-xl-semibold grow'>
            {t('datasetPipeline.inputFieldPanel.title')}
          </div>
          <button
            type='button'
            className='flex size-6 shrink-0 items-center justify-center p-0.5'
            onClick={closePanel}
          >
            <RiCloseLine className='size-4 text-text-tertiary' />
          </button>
        </div>
        <div className='system-sm-regular px-4 py-1 text-text-tertiary'>
          {t('datasetPipeline.inputFieldPanel.description')}
        </div>
        <div className='flex grow flex-col overflow-y-auto'>
          {/* Datasources Inputs */}
          {
            datasourceKeys.map((key) => {
              const inputFields = inputFieldsMap[key] || []
              if (!inputFields.length)
                return null
              return (
                <FieldList
                  key={key}
                  LabelRightContent={<Datasource title={datasourceTitleMap[key]} />}
                  inputFields={inputFields}
                  readonly={readonly}
                  labelClassName='pt-2 pb-1'
                  handleInputFieldsChange={updateInputFields.bind(null, key)}
                />
              )
            })
          }
          {/* Shared Inputs */}
          <FieldList
            LabelRightContent={<SharedInputs />}
            inputFields={inputFieldsMap.shared || []}
            readonly={readonly}
            labelClassName='pt-1 pb-2'
            handleInputFieldsChange={updateInputFields.bind(null, 'shared')}
          />
        </div>
        <FooterTip />
      </div>
    </DialogWrapper>
  )
}

export default memo(InputFieldDialog)
