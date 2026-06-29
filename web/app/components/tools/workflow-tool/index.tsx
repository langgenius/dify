'use client'
import type { DrawerRootProps } from '@langgenius/dify-ui/drawer'
import type { Emoji, WorkflowToolProviderOutputParameter, WorkflowToolProviderOutputSchema, WorkflowToolProviderParameter, WorkflowToolProviderRequest } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { produce } from 'immer'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from '#i18n'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { Infotip } from '@/app/components/base/infotip'
import Input from '@/app/components/base/input'
import LabelSelector from '@/app/components/tools/labels/selector'
import ConfirmModal from '@/app/components/tools/workflow-tool/confirm-modal'
import MethodSelector from '@/app/components/tools/workflow-tool/method-selector'
import {
  buildWorkflowToolRequestPayload,
  getReservedWorkflowOutputParameters,
  getWorkflowOutputParameters,
  hasReservedWorkflowOutputConflict,
  isWorkflowToolNameValid,
} from './helpers'

export type WorkflowToolDrawerPayload = {
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

export type WorkflowToolDrawerProps = {
  isAdd?: boolean
  payload: WorkflowToolDrawerPayload
  onHide: () => void
  onRemove?: () => void
  onCreate?: (payload: WorkflowToolProviderRequest & { workflow_app_id: string }) => void
  onSave?: (payload: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => void
}

type WorkflowToolDrawerFrameProps = {
  title: string
  closeLabel: string
  onHide: () => void
  children: React.ReactNode
}

const InfoTooltip = ({ children }: { children: string }) => {
  return (
    <Infotip
      aria-label={children}
      className="ml-1 size-3.5"
      iconClassName="h-3.5 w-3.5"
      popupClassName="w-[180px]"
    >
      {children}
    </Infotip>
  )
}

const WorkflowToolDrawerFrame = ({ title, closeLabel, onHide, children }: WorkflowToolDrawerFrameProps) => {
  const handleOpenChange = React.useCallback<NonNullable<DrawerRootProps['onOpenChange']>>((open) => {
    if (!open)
      onHide()
  }, [onHide])

  return (
    <Drawer open modal disablePointerDismissal swipeDirection="right" onOpenChange={handleOpenChange}>
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup
            data-testid="drawer"
            className={cn(
              'data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-[calc(100dvh-16px)] data-[swipe-direction=right]:w-160 data-[swipe-direction=right]:max-w-[calc(100vw-16px)]',
              'data-[swipe-direction=right]:rounded-xl data-[swipe-direction=right]:border-r-[0.5px] data-[swipe-direction=right]:border-divider-subtle',
            )}
          >
            <DrawerContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0 pb-0">
              <div className="shrink-0 border-b border-divider-subtle py-4">
                <div className="flex h-6 items-center justify-between pr-5 pl-6">
                  <DrawerTitle data-testid="drawer-title" className="min-w-0 truncate system-xl-semibold text-text-primary">
                    {title}
                  </DrawerTitle>
                  <DrawerCloseButton
                    className="size-6 rounded-md"
                    aria-label={closeLabel}
                  />
                </div>
              </div>
              <div className="grow overflow-hidden">
                {children}
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}

export function WorkflowToolDrawer({
  isAdd,
  payload,
  onHide,
  onRemove,
  onSave,
  onCreate,
}: WorkflowToolDrawerProps) {
  const { t } = useTranslation()

  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false)
  const [emoji, setEmoji] = useState<Emoji>(payload.icon)
  const [label, setLabel] = useState<string>(payload.label)
  const [name, setName] = useState(payload.name)
  const [description, setDescription] = useState(payload.description)
  const [parameters, setParameters] = useState<WorkflowToolProviderParameter[]>(payload.parameters)
  const rawOutputParameters = payload.outputParameters
  const outputSchema = payload.tool?.output_schema
  const outputParameters = useMemo<WorkflowToolProviderOutputParameter[]>(
    () => getWorkflowOutputParameters(rawOutputParameters, outputSchema),
    [rawOutputParameters, outputSchema],
  )
  const reservedOutputParameters = useMemo(
    () => getReservedWorkflowOutputParameters(t),
    [t],
  )

  const handleParameterChange = (key: string, value: string, index: number) => {
    const newData = produce(parameters, (draft: WorkflowToolProviderParameter[]) => {
      if (key === 'description')
        draft[index]!.description = value
      else
        draft[index]!.form = value
    })
    setParameters(newData)
  }
  const [labels, setLabels] = useState<string[]>(payload.labels)
  const handleLabelSelect = (value: string[]) => {
    setLabels(value)
  }
  const [privacyPolicy, setPrivacyPolicy] = useState(payload.privacy_policy)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)

  const onConfirm = () => {
    let errorMessage = ''
    if (!label)
      errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t('createTool.name', { ns: 'tools' }) })

    if (!name)
      errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t('createTool.nameForToolCall', { ns: 'tools' }) })

    if (!isWorkflowToolNameValid(name))
      errorMessage = t('createTool.nameForToolCall', { ns: 'tools' }) + t('createTool.nameForToolCallTip', { ns: 'tools' })

    if (errorMessage) {
      toast.error(errorMessage)
      return
    }

    const requestParams = buildWorkflowToolRequestPayload({
      name,
      description,
      emoji,
      label,
      parameters,
      labels,
      privacyPolicy,
    })
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
      <WorkflowToolDrawerFrame
        onHide={onHide}
        title={t('common.workflowAsTool', { ns: 'workflow' })!}
        closeLabel={t('operation.close', { ns: 'common' })!}
      >
        <div className="flex h-full flex-col">
          <div className="h-0 grow space-y-4 overflow-y-auto px-6 py-3">
            {/* name & icon */}
            <div>
              <div className="py-2 system-sm-medium text-text-primary">
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
              <div className="flex items-center py-2 system-sm-medium text-text-primary">
                {t('createTool.nameForToolCall', { ns: 'tools' })}
                {' '}
                <span className="ml-1 text-red-500">*</span>
                <InfoTooltip>
                  {t('createTool.nameForToolCallPlaceHolder', { ns: 'tools' })}
                </InfoTooltip>
              </div>
              <Input
                className="h-10"
                placeholder={t('createTool.nameForToolCallPlaceHolder', { ns: 'tools' })!}
                value={name}
                onChange={e => setName(e.target.value)}
              />
              {!isWorkflowToolNameValid(name) && (
                <div className="text-xs leading-[18px] text-red-500">{t('createTool.nameForToolCallTip', { ns: 'tools' })}</div>
              )}
            </div>
            {/* description */}
            <div>
              <div className="py-2 system-sm-medium text-text-primary">{t('createTool.description', { ns: 'tools' })}</div>
              <Textarea
                aria-label={t('createTool.description', { ns: 'tools' })}
                placeholder={t('createTool.descriptionPlaceholder', { ns: 'tools' }) || ''}
                value={description}
                onValueChange={value => setDescription(value)}
              />
            </div>
            {/* Tool Input  */}
            <div>
              <div className="py-2 system-sm-medium text-text-primary">{t('createTool.toolInput.title', { ns: 'tools' })}</div>
              <div className="w-full overflow-x-auto rounded-lg border border-divider-regular">
                <table className="w-full text-xs leading-[18px] font-normal text-text-secondary">
                  <thead className="text-text-tertiary uppercase">
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
                            <div className="flex">
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
                            className="w-full appearance-none bg-transparent text-[13px] leading-[18px] font-normal text-text-secondary caret-primary-600 outline-hidden placeholder:text-text-quaternary"
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
              <div className="py-2 system-sm-medium text-text-primary">{t('createTool.toolOutput.title', { ns: 'tools' })}</div>
              <div className="w-full overflow-x-auto rounded-lg border border-divider-regular">
                <table className="w-full text-xs leading-[18px] font-normal text-text-secondary">
                  <thead className="text-text-tertiary uppercase">
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
                            <div className="flex items-center">
                              <span className="truncate font-medium text-text-primary">{item.name}</span>
                              <span className="shrink-0 pl-1 text-xs leading-[18px] text-[#ec4a0a]">{item.reserved ? t('createTool.toolOutput.reserved', { ns: 'tools' }) : ''}</span>
                              {
                                !item.reserved && hasReservedWorkflowOutputConflict(reservedOutputParameters, item.name)
                                  ? (
                                      <Tooltip>
                                        <TooltipTrigger
                                          render={(
                                            <span data-testid="reserved-output-warning" className="i-ri-error-warning-line size-3 text-text-warning-secondary" />
                                          )}
                                        />
                                        <TooltipContent>
                                          <div className="w-[180px]">
                                            {t('createTool.toolOutput.reservedParameterDuplicateTip', { ns: 'tools' })}
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    )
                                  : null
                              }
                            </div>
                            <div className="text-text-tertiary">{item.type}</div>
                          </div>
                        </td>
                        <td className="w-[236px] p-2 pl-3 text-text-tertiary">
                          <span className="text-[13px] leading-[18px] font-normal text-text-secondary">{item.description}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Tags */}
            <div>
              <div className="py-2 system-sm-medium text-text-primary">{t('createTool.toolInput.label', { ns: 'tools' })}</div>
              <LabelSelector value={labels} onChange={handleLabelSelect} />
            </div>
            {/* Privacy Policy */}
            <div>
              <div className="py-2 system-sm-medium text-text-primary">{t('createTool.privacyPolicy', { ns: 'tools' })}</div>
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
              <Button variant="primary" tone="destructive" onClick={onRemove}>{t('operation.delete', { ns: 'common' })}</Button>
            )}
            <div className="flex space-x-2">
              <Button onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (isAdd)
                    onConfirm()
                  else
                    setConfirmModalOpen(true)
                }}
              >
                {t('operation.save', { ns: 'common' })}
              </Button>
            </div>
          </div>
        </div>
      </WorkflowToolDrawerFrame>
      <AppIconPicker
        open={showEmojiPicker}
        enableImageUpload={false}
        initialEmoji={{
          icon: emoji.content,
          background: emoji.background,
        }}
        onOpenChange={setShowEmojiPicker}
        onSelect={(payload) => {
          if (payload.type === 'emoji')
            setEmoji({ content: payload.icon, background: payload.background })
        }}
      />
      {confirmModalOpen && (
        <ConfirmModal
          show={confirmModalOpen}
          onClose={() => setConfirmModalOpen(false)}
          onConfirm={onConfirm}
        />
      )}
    </>

  )
}
