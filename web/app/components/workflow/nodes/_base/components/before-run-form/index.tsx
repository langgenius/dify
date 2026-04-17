'use client'
import type { FC } from 'react'
import type { Props as FormProps } from './form'
import type { Emoji } from '@/app/components/tools/types'
import type { SpecialResultPanelProps } from '@/app/components/workflow/run/special-result-panel'
import type { NodeRunningStatus } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import { toast } from '@/app/components/base/ui/toast'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import SingleRunForm from '@/app/components/workflow/nodes/human-input/components/single-run-form'
import { BlockEnum } from '@/app/components/workflow/types'
import Form from './form'
import {
  buildSubmitData,
  getFormErrorMessage,
  isFilesLoaded,
  shouldAutoRunBeforeRunForm,
  shouldAutoShowGeneratedForm,
} from './helpers'
import PanelWrap from './panel-wrap'

const i18nPrefix = 'singleRun'

export type BeforeRunFormProps = {
  nodeName: string
  nodeType?: BlockEnum
  toolIcon?: string | Emoji
  onHide: () => void
  onRun: (submitData: Record<string, any>) => void
  onStop: () => void
  runningStatus: NodeRunningStatus
  forms: FormProps[]
  showSpecialResultPanel?: boolean
  existVarValuesInForms: Record<string, any>[]
  filteredExistVarForms: FormProps[]
  showGeneratedForm?: boolean
  handleShowGeneratedForm?: (data: Record<string, any>) => void
  handleHideGeneratedForm?: () => void
  formData?: HumanInputFormData
  handleSubmitHumanInputForm?: (data: any) => Promise<void>
  handleAfterHumanInputStepRun?: () => void
} & Partial<SpecialResultPanelProps>

const BeforeRunForm: FC<BeforeRunFormProps> = ({
  nodeName,
  nodeType,
  onHide,
  onRun,
  forms,
  filteredExistVarForms,
  existVarValuesInForms,
  showGeneratedForm = false,
  handleShowGeneratedForm,
  handleHideGeneratedForm,
  formData,
  handleSubmitHumanInputForm,
  handleAfterHumanInputStepRun,
}) => {
  const { t } = useTranslation()

  const isHumanInput = nodeType === BlockEnum.HumanInput
  const showBackButton = filteredExistVarForms.length > 0

  const isFileLoaded = isFilesLoaded(forms)

  const handleRunOrGenerateForm = () => {
    const errMsg = getFormErrorMessage(forms, existVarValuesInForms, t)
    if (errMsg) {
      toast.error(errMsg)
      return
    }

    const { submitData, parseErrorJsonField } = buildSubmitData(forms)
    if (parseErrorJsonField) {
      toast.error(t('errorMsg.invalidJson', { ns: 'workflow', field: parseErrorJsonField }))
      return
    }

    if (isHumanInput)
      handleShowGeneratedForm?.(submitData)
    else
      onRun(submitData)
  }

  const handleHumanInputFormSubmit = async (data: any) => {
    await handleSubmitHumanInputForm?.(data)
    handleAfterHumanInputStepRun?.()
  }

  const hasRun = useRef(false)
  useEffect(() => {
    // React 18 run twice in dev mode
    if (hasRun.current)
      return
    hasRun.current = true
    if (shouldAutoRunBeforeRunForm(filteredExistVarForms, isHumanInput))
      onRun({})
    if (shouldAutoShowGeneratedForm(filteredExistVarForms, isHumanInput))
      handleShowGeneratedForm?.({})
  }, [filteredExistVarForms, handleShowGeneratedForm, isHumanInput, onRun])

  if (shouldAutoRunBeforeRunForm(filteredExistVarForms, isHumanInput))
    return null

  return (
    <PanelWrap
      nodeName={nodeName}
      onHide={onHide}
    >
      <div className="h-0 grow overflow-y-auto pb-4">
        {!showGeneratedForm && (
          <div className="mt-3 space-y-4 px-4">
            {filteredExistVarForms.map((form, index) => (
              <div key={index}>
                <Form
                  key={index}
                  className={cn(index < forms.length - 1 && 'mb-4')}
                  {...form}
                />
                {index < forms.length - 1 && <Split />}
              </div>
            ))}
          </div>
        )}
        {showGeneratedForm && formData && (
          <SingleRunForm
            nodeName={nodeName}
            showBackButton={showBackButton}
            handleBack={handleHideGeneratedForm}
            data={formData}
            onSubmit={handleHumanInputFormSubmit}
          />
        )}
        {!showGeneratedForm && (
          <div className="mt-4 flex justify-between space-x-2 px-4">
            {!isHumanInput && (
              <Button disabled={!isFileLoaded} variant="primary" className="w-0 grow space-x-2" onClick={handleRunOrGenerateForm}>
                <div>{t(`${i18nPrefix}.startRun`, { ns: 'workflow' })}</div>
              </Button>
            )}
            {isHumanInput && (
              <Button disabled={!isFileLoaded} variant="primary" className="w-0 grow space-x-2" onClick={handleRunOrGenerateForm}>
                <div>{t('nodes.humanInput.singleRun.button', { ns: 'workflow' })}</div>
              </Button>
            )}
          </div>
        )}
      </div>
    </PanelWrap>
  )
}
export default React.memo(BeforeRunForm)
