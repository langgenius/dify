'use client'
import type { FC } from 'react'
import type { Emoji, WorkflowToolProviderOutputParameter, WorkflowToolProviderOutputSchema, WorkflowToolProviderParameter, WorkflowToolProviderRequest } from '../types'
import type { WorkflowToolFormPayload } from './hooks/use-workflow-tool-form'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import Drawer from '@/app/components/base/drawer-plus'
import EmojiPicker from '@/app/components/base/emoji-picker'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Tooltip from '@/app/components/base/tooltip'
import LabelSelector from '@/app/components/tools/labels/selector'
import ConfirmModal from '@/app/components/tools/workflow-tool/confirm-modal'
import { cn } from '@/utils/classnames'
import ToolInputTable from './components/tool-input-table'
import ToolOutputTable from './components/tool-output-table'
import { useModalState } from './hooks/use-modal-state'
import { useWorkflowToolForm } from './hooks/use-workflow-tool-form'

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
  payload: WorkflowToolFormPayload
  onHide: () => void
  onRemove?: () => void
  onCreate?: (payload: WorkflowToolProviderRequest & { workflow_app_id: string }) => void
  onSave?: (payload: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => void
}

// Form field wrapper component
type FormFieldProps = {
  label: string
  required?: boolean
  tooltip?: string
  children: React.ReactNode
}

const FormField: FC<FormFieldProps> = ({ label, required, tooltip, children }) => (
  <div>
    <div className="system-sm-medium flex items-center py-2 text-text-primary">
      {label}
      {required && <span className="ml-1 text-red-500">*</span>}
      {tooltip && (
        <Tooltip popupContent={<div className="w-[180px]">{tooltip}</div>} />
      )}
    </div>
    {children}
  </div>
)

// Footer actions component
type FooterActionsProps = {
  isAdd?: boolean
  onRemove?: () => void
  onHide: () => void
  onSaveClick: () => void
}

const FooterActions: FC<FooterActionsProps> = ({ isAdd, onRemove, onHide, onSaveClick }) => {
  const { t } = useTranslation()
  const showDeleteButton = !isAdd && onRemove

  return (
    <div className={cn(
      showDeleteButton ? 'justify-between' : 'justify-end',
      'mt-2 flex shrink-0 rounded-b-[10px] border-t border-divider-regular bg-background-section-burn px-6 py-4',
    )}
    >
      {showDeleteButton && (
        <Button variant="warning" onClick={onRemove}>
          {t('operation.delete', { ns: 'common' })}
        </Button>
      )}
      <div className="flex space-x-2">
        <Button onClick={onHide}>
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button variant="primary" onClick={onSaveClick}>
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}

// Main component
const WorkflowToolAsModal: FC<Props> = ({
  isAdd,
  payload,
  onHide,
  onRemove,
  onSave,
  onCreate,
}) => {
  const { t } = useTranslation()

  // Modal states
  const emojiPicker = useModalState(false)
  const confirmModal = useModalState(false)

  // Form state and logic
  const form = useWorkflowToolForm({
    payload,
    isAdd,
    onCreate,
    onSave,
  })

  // Handle save button click
  const handleSaveClick = () => {
    if (isAdd)
      form.onConfirm()
    else
      confirmModal.open()
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
              {/* Name & Icon */}
              <FormField label={t('createTool.name', { ns: 'tools' })} required>
                <div className="flex items-center justify-between gap-3">
                  <AppIcon
                    size="large"
                    onClick={emojiPicker.open}
                    className="cursor-pointer"
                    iconType="emoji"
                    icon={form.emoji.content}
                    background={form.emoji.background}
                  />
                  <Input
                    className="h-10 grow"
                    placeholder={t('createTool.toolNamePlaceHolder', { ns: 'tools' })!}
                    value={form.label}
                    onChange={e => form.setLabel(e.target.value)}
                  />
                </div>
              </FormField>

              {/* Name for Tool Call */}
              <FormField
                label={t('createTool.nameForToolCall', { ns: 'tools' })}
                required
                tooltip={t('createTool.nameForToolCallPlaceHolder', { ns: 'tools' })}
              >
                <Input
                  className="h-10"
                  placeholder={t('createTool.nameForToolCallPlaceHolder', { ns: 'tools' })!}
                  value={form.name}
                  onChange={e => form.setName(e.target.value)}
                />
                {!form.isNameValid && (
                  <div className="text-xs leading-[18px] text-red-500">
                    {t('createTool.nameForToolCallTip', { ns: 'tools' })}
                  </div>
                )}
              </FormField>

              {/* Description */}
              <FormField label={t('createTool.description', { ns: 'tools' })}>
                <Textarea
                  placeholder={t('createTool.descriptionPlaceholder', { ns: 'tools' }) || ''}
                  value={form.description}
                  onChange={e => form.setDescription(e.target.value)}
                />
              </FormField>

              {/* Tool Input */}
              <FormField label={t('createTool.toolInput.title', { ns: 'tools' })}>
                <ToolInputTable
                  parameters={form.parameters}
                  onParameterChange={form.handleParameterChange}
                />
              </FormField>

              {/* Tool Output */}
              <FormField label={t('createTool.toolOutput.title', { ns: 'tools' })}>
                <ToolOutputTable
                  parameters={form.allOutputParameters}
                  isReserved={form.isOutputParameterReserved}
                />
              </FormField>

              {/* Tags */}
              <FormField label={t('createTool.toolInput.label', { ns: 'tools' })}>
                <LabelSelector value={form.labels} onChange={form.setLabels} />
              </FormField>

              {/* Privacy Policy */}
              <FormField label={t('createTool.privacyPolicy', { ns: 'tools' })}>
                <Input
                  className="h-10"
                  value={form.privacyPolicy}
                  onChange={e => form.setPrivacyPolicy(e.target.value)}
                  placeholder={t('createTool.privacyPolicyPlaceholder', { ns: 'tools' }) || ''}
                />
              </FormField>
            </div>

            <FooterActions
              isAdd={isAdd}
              onRemove={onRemove}
              onHide={onHide}
              onSaveClick={handleSaveClick}
            />
          </div>
        )}
        isShowMask={true}
        clickOutsideNotOpen={true}
      />

      {/* Emoji Picker Modal */}
      {emojiPicker.isOpen && (
        <EmojiPicker
          onSelect={(icon, icon_background) => {
            form.setEmoji({ content: icon, background: icon_background })
            emojiPicker.close()
          }}
          onClose={emojiPicker.close}
        />
      )}

      {/* Confirm Modal */}
      {confirmModal.isOpen && (
        <ConfirmModal
          show={confirmModal.isOpen}
          onClose={confirmModal.close}
          onConfirm={form.onConfirm}
        />
      )}
    </>
  )
}

export default React.memo(WorkflowToolAsModal)
