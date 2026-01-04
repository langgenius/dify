'use client'
import type { FC } from 'react'
import type { Props as FormProps } from './form'
import type { Emoji } from '@/app/components/tools/types'
import type { SpecialResultPanelProps } from '@/app/components/workflow/run/special-result-panel'
import type { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import Toast from '@/app/components/base/toast'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { cn } from '@/utils/classnames'
import Form from './form'
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
} & Partial<SpecialResultPanelProps>

function formatValue(value: string | any, type: InputVarType) {
  if (type === InputVarType.checkbox)
    return !!value
  if (value === undefined || value === null)
    return value
  if (type === InputVarType.number)
    return Number.parseFloat(value)
  if (type === InputVarType.json)
    return JSON.parse(value)
  if (type === InputVarType.contexts) {
    return value.map((item: any) => {
      return JSON.parse(item)
    })
  }
  if (type === InputVarType.multiFiles)
    return getProcessedFiles(value)

  if (type === InputVarType.singleFile) {
    if (Array.isArray(value))
      return getProcessedFiles(value)
    if (!value)
      return undefined
    return getProcessedFiles([value])[0]
  }

  return value
}
const BeforeRunForm: FC<BeforeRunFormProps> = ({
  nodeName,
  onHide,
  onRun,
  forms,
  filteredExistVarForms,
  existVarValuesInForms,
}) => {
  const { t } = useTranslation()

  const isFileLoaded = (() => {
    if (!forms || forms.length === 0)
      return true
    // system files
    const filesForm = forms.find(item => !!item.values['#files#'])
    if (!filesForm)
      return true

    const files = filesForm.values['#files#'] as any
    if (files?.some((item: any) => item.transfer_method === TransferMethod.local_file && !item.upload_file_id))
      return false

    return true
  })()
  const handleRun = () => {
    let errMsg = ''
    forms.forEach((form, i) => {
      const existVarValuesInForm = existVarValuesInForms[i]

      form.inputs.forEach((input) => {
        const value = form.values[input.variable] as any
        if (!errMsg && input.required && (input.type !== InputVarType.checkbox) && !(input.variable in existVarValuesInForm) && (value === '' || value === undefined || value === null || (input.type === InputVarType.files && value.length === 0)))
          errMsg = t('errorMsg.fieldRequired', { ns: 'workflow', field: typeof input.label === 'object' ? input.label.variable : input.label })

        if (!errMsg && (input.type === InputVarType.singleFile || input.type === InputVarType.multiFiles) && value) {
          let fileIsUploading = false
          if (Array.isArray(value))
            fileIsUploading = value.find(item => item.transferMethod === TransferMethod.local_file && !item.uploadedId)
          else
            fileIsUploading = value.transferMethod === TransferMethod.local_file && !value.uploadedId

          if (fileIsUploading)
            errMsg = t('errorMessage.waitForFileUpload', { ns: 'appDebug' })
        }
      })
    })
    if (errMsg) {
      Toast.notify({
        message: errMsg,
        type: 'error',
      })
      return
    }

    const submitData: Record<string, any> = {}
    let parseErrorJsonField = ''
    forms.forEach((form) => {
      form.inputs.forEach((input) => {
        try {
          const value = formatValue(form.values[input.variable], input.type)
          submitData[input.variable] = value
        }
        catch {
          parseErrorJsonField = input.variable
        }
      })
    })
    if (parseErrorJsonField) {
      Toast.notify({
        message: t('errorMsg.invalidJson', { ns: 'workflow', field: parseErrorJsonField }),
        type: 'error',
      })
      return
    }

    onRun(submitData)
  }
  const hasRun = useRef(false)
  useEffect(() => {
    // React 18 run twice in dev mode
    if (hasRun.current)
      return
    hasRun.current = true
    if (filteredExistVarForms.length === 0)
      onRun({})
  }, [filteredExistVarForms, onRun])

  if (filteredExistVarForms.length === 0)
    return null

  return (
    <PanelWrap
      nodeName={nodeName}
      onHide={onHide}
    >
      <div className="h-0 grow overflow-y-auto pb-4">
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
        <div className="mt-4 flex justify-between space-x-2 px-4">
          <Button disabled={!isFileLoaded} variant="primary" className="w-0 grow space-x-2" onClick={handleRun}>
            <div>{t(`${i18nPrefix}.startRun`, { ns: 'workflow' })}</div>
          </Button>
        </div>
      </div>
    </PanelWrap>
  )
}
export default React.memo(BeforeRunForm)
