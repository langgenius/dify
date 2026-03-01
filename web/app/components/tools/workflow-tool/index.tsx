'use client'
import type { FC } from 'react'
import type { Emoji, WorkflowToolProviderOutputParameter, WorkflowToolProviderOutputSchema, WorkflowToolProviderParameter, WorkflowToolProviderRequest } from '../types'
import { RiErrorWarningLine } from '@remixicon/react'
import { produce } from 'immer'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import Drawer from '@/app/components/base/drawer-plus'
import EmojiPicker from '@/app/components/base/emoji-picker'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import LabelSelector from '@/app/components/tools/labels/selector'
import ConfirmModal from '@/app/components/tools/workflow-tool/confirm-modal'
import MethodSelector from '@/app/components/tools/workflow-tool/method-selector'
import { VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import { buildWorkflowOutputParameters } from './utils'

export type WorkflowToolModalPayload = {
  icon: Emoji
  label: string
  name: string
  description: string
  parameters: WorkflowToolProviderParameter[]
  outputParameters: WorkflowToolProviderOutputParameter[]
  labels: string[]
  privacy_policy: string
  tool?: {
    output_schema?: WorkflowToolProviderOutputSchema
  }
  workflow_tool_id?: string
  workflow_app_id?: string
}

type Props = {
  isAdd?: boolean
  payload: WorkflowToolModalPayload
  onHide: () => void
  onRemove?: () => void
  onCreate?: (payload: WorkflowToolProviderRequest & { workflow_app_id: string }) => void
  onSave?: (payload: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => void
}
// Add and Edit
const WorkflowToolAsModal: FC<Props> = ({
  isAdd,
  payload,
  onHide,
  onRemove,
  onSave,
  onCreate,
}) => {
  const { t } = useTranslation()

  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false)
  const [emoji, setEmoji] = useState<Emoji>(payload.icon)
  const [label, setLabel] = useState<string>(payload.label)
  const [name, setName] = useState(payload.name)
  const [description, setDescription] = useState(payload.description)
  const [parameters, setParameters] = useState<WorkflowToolProviderParameter[]>(payload.parameters)
  const rawOutputParameters = payload.outputParameters
  const outputSchema = payload.tool?.output_schema
  const outputParameters = useMemo<WorkflowToolProviderOutputParameter[]>(() => buildWorkflowOutputParameters(rawOutputParameters, outputSchema), [rawOutputParameters, outputSchema])
  const reservedOutputParameters: WorkflowToolProviderOutputParameter[] = [
    {
      name: 'text',
      description: t('nodes.tool.outputVars.text', { ns: 'workflow' }),
      type: VarType.string,
      reserved: true,
    },
    {
      name: 'files',
      description: t('nodes.tool.outputVars.files.title', { ns: 'workflow' }),
      type: VarType.arrayFile,
      reserved: true,
    },
    {
      name: 'json',
      description: t('nodes.tool.outputVars.json', { ns: 'workflow' }),
      type: VarType.arrayObject,
      reserved: true,
    },
  ]

  const handleParameterChange = (key: string, value: string, index: number) => {
    const newData = produce(parameters, (draft: WorkflowToolProviderParameter[]) => {
      if (key === 'description')
        draft[index].description = value
      else
        draft[index].form = value
    })
    setParameters(newData)
  }
  const [labels, setLabels] = useState<string[]>(payload.labels)
  const handleLabelSelect = (value: string[]) => {
    setLabels(value)
  }
  const [privacyPolicy, setPrivacyPolicy] = useState(payload.privacy_policy)
  const [showModal, setShowModal] = useState(false)

  const isNameValid = (name: string) => {
    // when the user has not input anything, no need for a warning
    if (name === '')
      return true

    return /^\w+$/.test(name)
  }

  const isOutputParameterReserved = (name: string) => {
    return reservedOutputParameters.find(p => p.name === name)
  }

  const onConfirm = () => {
    let errorMessage = ''
    if (!label)
      errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t('createTool.name', { ns: 'tools' }) })

    if (!name)
      errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t('createTool.nameForToolCall', { ns: 'tools' }) })

    if (!isNameValid(name))
      errorMessage = t('createTool.nameForToolCall', { ns: 'tools' }) + t('createTool.nameForToolCallTip', { ns: 'tools' })

    if (errorMessage) {
      Toast.notify({
        type: 'error',
        message: errorMessage,
      })
      return
    }

    const requestParams = {
      name,
      description,
      icon: emoji,
      label,
      parameters: parameters.map(item => ({
        name: item.name,
        description: item.description,
        form: item.form,
      })),
      labels,
      privacy_policy: privacyPolicy,
    }
    if (!isAdd) {
      onSave?.({
        ...requestParams,
        workflow_tool_id: payload.workflow_tool_id!,
      })
    }
    else {
      onCreate?.({
        ...requestParams,
        workflow_app_id: payload.workflow_app_id!,
      })
    }
  }

  return (
    <>
      <Drawer
        isShow
        onHide={onHide}
        title={t('common.workflowAsTool', { ns: 'workflow' })!}
        panelClassName="mt-2 !w-[640px]"
        maxWidthClassName="!max-w-[640px]"
        height="calc(100vh - 16px)"
        headerClassName="!border-b-divider"
        body={(
          <div className="flex h-full flex-col">
            <div className="h-0 grow space-y-4 overflow-y-auto px-6 py-3">
              {/* name & icon */}
              <div>
                <div className="system-sm-medium py-2 text-text-primary">
                  {t('createTool.name', { ns: 'tools' })}
                  {' '}
                  <span className="ml-1 text-red-500">*</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <AppIcon size="large" onClick={() => { setShowEmojiPicker(true) }} className="cursor-pointer" iconType="emoji" icon={emoji.content} background={emoji.background} />
                  <Input
                    className="h-10 grow"
                    placeholder={t('createTool.toolNamePlaceHolder', { ns: 'tools' })!}
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                  />
                </div>
              </div>
              {/* name for tool call */}
              <div>
                <div className="system-sm-medium flex items-center py-2 text-text-primary">
                  {t('createTool.nameForToolCall', { ns: 'tools' })}
                  {' '}
                  <span className="ml-1 text-red-500">*</span>
                  <Tooltip
                    popupContent={(
                      <div className="w-[180px]">
                        {t('createTool.nameForToolCallPlaceHolder', { ns: 'tools' })}
                      </div>
                    )}
                  />
                </div>
                <Input
                  className="h-10"
                  placeholder={t('createTool.nameForToolCallPlaceHolder', { ns: 'tools' })!}
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
                {!isNameValid(name) && (
                  <div className="text-xs leading-[18px] text-red-500">{t('createTool.nameForToolCallTip', { ns: 'tools' })}</div>
                )}
              </div>
              {/* description */}
              <div>
                <div className="system-sm-medium py-2 text-text-primary">{t('createTool.description', { ns: 'tools' })}</div>
                <Textarea
                  placeholder={t('createTool.descriptionPlaceholder', { ns: 'tools' }) || ''}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
              {/* Tool Input  */}
              <div>
                <div className="system-sm-medium py-2 text-text-primary">{t('createTool.toolInput.title', { ns: 'tools' })}</div>
                <div className="w-full overflow-x-auto rounded-lg border border-divider-regular">
                  <table className="w-full text-xs font-normal leading-[18px] text-text-secondary">
                    <thead className="uppercase text-text-tertiary">
                      <tr className="border-b border-divider-regular">
                        <th className="w-[156px] p-2 pl-3 font-medium">{t('createTool.toolInput.name', { ns: 'tools' })}</th>
                        <th className="w-[102px] p-2 pl-3 font-medium">{t('createTool.toolInput.method', { ns: 'tools' })}</th>
                        <th className="p-2 pl-3 font-medium">{t('createTool.toolInput.description', { ns: 'tools' })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parameters.map((item, index) => (
                        <tr key={index} className="border-b border-divider-regular last:border-0">
                          <td className="max-w-[156px] p-2 pl-3">
                            <div className="text-[13px] leading-[18px]">
                              <div title={item.name} className="flex">
                                <span className="truncate font-medium text-text-primary">{item.name}</span>
                                <span className="shrink-0 pl-1 text-xs leading-[18px] text-[#ec4a0a]">{item.required ? t('createTool.toolInput.required', { ns: 'tools' }) : ''}</span>
                              </div>
                              <div className="text-text-tertiary">{item.type}</div>
                            </div>
                          </td>
                          <td>
                            {item.name === '__image' && (
                              <div className={cn(
                                'flex h-9 min-h-[56px] cursor-default items-center gap-1 bg-transparent px-3 py-2',
                              )}
                              >
                                <div className={cn('grow truncate text-[13px] leading-[18px] text-text-secondary')}>
                                  {t('createTool.toolInput.methodParameter', { ns: 'tools' })}
                                </div>
                              </div>
                            )}
                            {item.name !== '__image' && (
                              <MethodSelector value={item.form} onChange={value => handleParameterChange('form', value, index)} />
                            )}
                          </td>
                          <td className="w-[236px] p-2 pl-3 text-text-tertiary">
                            <input
                              type="text"
                              className="w-full appearance-none bg-transparent text-[13px] font-normal leading-[18px] text-text-secondary caret-primary-600 outline-none placeholder:text-text-quaternary"
                              placeholder={t('createTool.toolInput.descriptionPlaceholder', { ns: 'tools' })!}
                              value={item.description}
                              onChange={e => handleParameterChange('description', e.target.value, index)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Tool Output  */}
              <div>
                <div className="system-sm-medium py-2 text-text-primary">{t('createTool.toolOutput.title', { ns: 'tools' })}</div>
                <div className="w-full overflow-x-auto rounded-lg border border-divider-regular">
                  <table className="w-full text-xs font-normal leading-[18px] text-text-secondary">
                    <thead className="uppercase text-text-tertiary">
                      <tr className="border-b border-divider-regular">
                        <th className="w-[156px] p-2 pl-3 font-medium">{t('createTool.name', { ns: 'tools' })}</th>
                        <th className="p-2 pl-3 font-medium">{t('createTool.toolOutput.description', { ns: 'tools' })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...reservedOutputParameters, ...outputParameters].map((item, index) => (
                        <tr key={index} className="border-b border-divider-regular last:border-0">
                          <td className="max-w-[156px] p-2 pl-3">
                            <div className="text-[13px] leading-[18px]">
                              <div title={item.name} className="flex items-center">
                                <span className="truncate font-medium text-text-primary">{item.name}</span>
                                <span className="shrink-0 pl-1 text-xs leading-[18px] text-[#ec4a0a]">{item.reserved ? t('createTool.toolOutput.reserved', { ns: 'tools' }) : ''}</span>
                                {
                                  !item.reserved && isOutputParameterReserved(item.name)
                                    ? (
                                        <Tooltip
                                          popupContent={(
                                            <div className="w-[180px]">
                                              {t('createTool.toolOutput.reservedParameterDuplicateTip', { ns: 'tools' })}
                                            </div>
                                          )}
                                        >
                                          <RiErrorWarningLine className="h-3 w-3 text-text-warning-secondary" />
                                        </Tooltip>
                                      )
                                    : null
                                }
                              </div>
                              <div className="text-text-tertiary">{item.type}</div>
                            </div>
                          </td>
                          <td className="w-[236px] p-2 pl-3 text-text-tertiary">
                            <span className="text-[13px] font-normal leading-[18px] text-text-secondary">{item.description}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Tags */}
              <div>
                <div className="system-sm-medium py-2 text-text-primary">{t('createTool.toolInput.label', { ns: 'tools' })}</div>
                <LabelSelector value={labels} onChange={handleLabelSelect} />
              </div>
              {/* Privacy Policy */}
              <div>
                <div className="system-sm-medium py-2 text-text-primary">{t('createTool.privacyPolicy', { ns: 'tools' })}</div>
                <Input
                  className="h-10"
                  value={privacyPolicy}
                  onChange={e => setPrivacyPolicy(e.target.value)}
                  placeholder={t('createTool.privacyPolicyPlaceholder', { ns: 'tools' }) || ''}
                />
              </div>
            </div>
            <div className={cn((!isAdd && onRemove) ? 'justify-between' : 'justify-end', 'mt-2 flex shrink-0 rounded-b-[10px] border-t border-divider-regular bg-background-section-burn px-6 py-4')}>
              {!isAdd && onRemove && (
                <Button variant="warning" onClick={onRemove}>{t('operation.delete', { ns: 'common' })}</Button>
              )}
              <div className="flex space-x-2 ">
                <Button onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (isAdd)
                      onConfirm()
                    else
                      setShowModal(true)
                  }}
                >
                  {t('operation.save', { ns: 'common' })}
                </Button>
              </div>
            </div>
          </div>
        )}
        isShowMask={true}
        clickOutsideNotOpen={true}
      />
      {showEmojiPicker && (
        <EmojiPicker
          onSelect={(icon, icon_background) => {
            setEmoji({ content: icon, background: icon_background })
            setShowEmojiPicker(false)
          }}
          onClose={() => {
            setShowEmojiPicker(false)
          }}
        />
      )}
      {showModal && (
        <ConfirmModal
          show={showModal}
          onClose={() => setShowModal(false)}
          onConfirm={onConfirm}
        />
      )}
    </>

  )
}
export default React.memo(WorkflowToolAsModal)
