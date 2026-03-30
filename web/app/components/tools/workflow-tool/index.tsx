'use client'
import type { FC } from 'react'
import type { WorkflowToolModalProps } from './types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Drawer from '@/app/components/base/drawer-plus'
import EmojiPicker from '@/app/components/base/emoji-picker'
import ConfirmModal from '@/app/components/tools/workflow-tool/confirm-modal'
import { useWorkflowToolForm } from './use-workflow-tool-form'
import WorkflowToolForm from './workflow-tool-form'

export type { WorkflowToolModalPayload } from './types'

const WorkflowToolAsModal: FC<WorkflowToolModalProps> = ({
  isAdd,
  payload,
  onHide,
  onRemove,
  onSave,
  onCreate,
}) => {
  const { t } = useTranslation()
  const {
    description,
    emoji,
    handleConfirm,
    handleParameterChange,
    handlePrimaryAction,
    isNameCurrentlyValid,
    label,
    labels,
    name,
    outputParameters,
    parameters,
    privacyPolicy,
    setDescription,
    setEmoji,
    setLabel,
    setLabels,
    setName,
    setPrivacyPolicy,
    setShowConfirmModal,
    setShowEmojiPicker,
    showConfirmModal,
    showEmojiPicker,
  } = useWorkflowToolForm({
    isAdd,
    onCreate,
    onSave,
    payload,
  })

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
          <WorkflowToolForm
            description={description}
            emoji={emoji}
            isAdd={isAdd}
            isNameValid={isNameCurrentlyValid}
            labels={labels}
            name={name}
            onDescriptionChange={setDescription}
            onEmojiClick={() => setShowEmojiPicker(true)}
            onHide={onHide}
            onLabelChange={setLabels}
            onNameChange={setName}
            onParameterChange={handleParameterChange}
            onPrimaryAction={handlePrimaryAction}
            onPrivacyPolicyChange={setPrivacyPolicy}
            onRemove={onRemove}
            onTitleChange={setLabel}
            outputParameters={outputParameters}
            parameters={parameters}
            privacyPolicy={privacyPolicy}
            title={label}
          />
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
      {showConfirmModal && (
        <ConfirmModal
          show={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  )
}
export default React.memo(WorkflowToolAsModal)
