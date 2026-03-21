import type { FC } from 'react'
import type { HumanInputNodeType } from './types'
import type { NodePanelProps, Var } from '@/app/components/workflow/types'
import {
  RiAddLine,
  RiClipboardLine,
  RiCollapseDiagonalLine,
  RiExpandDiagonalLine,
  RiEyeLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { useStore } from '@/app/components/workflow/store'
import { VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import DeliveryMethod from './components/delivery-method'
import FormContent from './components/form-content'
import FormContentPreview from './components/form-content-preview'
import TimeoutInput from './components/timeout'
import UserActionItem from './components/user-action'
import useConfig from './hooks/use-config'
import { UserActionButtonType } from './types'

const i18nPrefix = 'nodes.humanInput'

const Panel: FC<NodePanelProps<HumanInputNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    readOnly,
    inputs,
    handleDeliveryMethodChange,
    handleUserActionAdd,
    handleUserActionChange,
    handleUserActionDelete,
    handleTimeoutChange,
    handleFormContentChange,
    handleFormInputsChange,
    handleFormInputItemRename,
    handleFormInputItemRemove,
    editorKey,
    structuredOutputCollapsed,
    setStructuredOutputCollapsed,
  } = useConfig(id, data)

  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    },
  })

  const [isExpandFormContent, {
    toggle: toggleExpandFormContent,
  }] = useBoolean(false)
  const nodePanelWidth = useStore(state => state.nodePanelWidth)

  const [isPreview, {
    toggle: togglePreview,
    setFalse: hidePreview,
  }] = useBoolean(false)

  const onAddUseAction = useCallback(() => {
    const index = inputs.user_actions.length + 1
    handleUserActionAdd({
      id: `action_${index}`,
      title: `Button Text ${index}`,
      button_style: UserActionButtonType.Default,
    })
  }, [handleUserActionAdd, inputs.user_actions.length])

  return (
    <div className="py-2">
      {/* delivery methods */}
      <DeliveryMethod
        nodeId={id}
        value={inputs.delivery_methods || []}
        formContent={inputs.form_content}
        formInputs={inputs.inputs}
        nodesOutputVars={availableVars}
        availableNodes={availableNodesWithParent}
        onChange={handleDeliveryMethodChange}
        readonly={readOnly}
      />
      <div className="px-4 py-2">
        <Divider className="!my-0 !h-px !bg-divider-subtle" />
      </div>
      {/* form content */}
      <div
        className={cn('px-4 py-2', isExpandFormContent && 'fixed bottom-[8px] right-[4px] top-[244px] z-10 flex flex-col rounded-b-2xl bg-components-panel-bg')}
        style={{
          width: isExpandFormContent ? nodePanelWidth : '100%',
        }}
      >
        <div className="mb-1 flex shrink-0 items-center justify-between">
          <div className="flex h-6 items-center gap-0.5">
            <div className="system-sm-semibold-uppercase text-text-secondary">{t(`${i18nPrefix}.formContent.title`, { ns: 'workflow' })}</div>
            <Tooltip
              popupContent={t(`${i18nPrefix}.formContent.tooltip`, { ns: 'workflow' })}
            />
          </div>
          {!readOnly && (
            <div className="flex items-center ">
              <Button
                variant="ghost"
                size="small"
                className={cn(
                  'flex items-center space-x-1 px-2',
                  isPreview && 'bg-state-accent-active text-text-accent',
                )}
                onClick={togglePreview}
              >
                <RiEyeLine className="size-3.5" />
                <div className="system-xs-medium">{t(`${i18nPrefix}.formContent.preview`, { ns: 'workflow' })}</div>
              </Button>
              <div className="mx-2 h-3 w-px bg-divider-regular"></div>
              <div className="flex items-center space-x-1">
                <div
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-components-button-ghost-bg-hover"
                  onClick={() => {
                    copy(inputs.form_content)
                    Toast.notify({ type: 'success', message: t('actionMsg.copySuccessfully', { ns: 'common' }) })
                  }}
                >
                  <RiClipboardLine className="h-4 w-4 text-text-secondary" />
                </div>
                <div className={cn('flex size-6 cursor-pointer items-center justify-center rounded-md text-text-secondary hover:bg-components-button-ghost-bg-hover', isExpandFormContent && 'bg-state-accent-active text-text-accent')} onClick={toggleExpandFormContent}>
                  {isExpandFormContent ? <RiCollapseDiagonalLine className="h-4 w-4" /> : <RiExpandDiagonalLine className="h-4 w-4" />}
                </div>
              </div>
            </div>
          )}
        </div>
        <FormContent
          editorKey={editorKey}
          nodeId={id}
          value={inputs.form_content}
          onChange={handleFormContentChange}
          formInputs={inputs.inputs}
          onFormInputsChange={handleFormInputsChange}
          onFormInputItemRename={handleFormInputItemRename}
          onFormInputItemRemove={handleFormInputItemRemove}
          isExpand={isExpandFormContent}
          availableVars={availableVars}
          availableNodes={availableNodesWithParent}
          readonly={readOnly}
        />
      </div>
      {/* user actions */}
      <div className="px-4 py-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <div className="system-sm-semibold-uppercase text-text-secondary">{t(`${i18nPrefix}.userActions.title`, { ns: 'workflow' })}</div>
            <Tooltip
              popupContent={t(`${i18nPrefix}.userActions.tooltip`, { ns: 'workflow' })}
            />
          </div>
          {!readOnly && (
            <div className="flex items-center px-1">
              <ActionButton
                onClick={onAddUseAction}
              >
                <RiAddLine className="h-4 w-4" />
              </ActionButton>
            </div>
          )}
        </div>
        {!inputs.user_actions.length && (
          <div className="system-xs-regular flex items-center justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary">{t(`${i18nPrefix}.userActions.emptyTip`, { ns: 'workflow' })}</div>
        )}
        {inputs.user_actions.length > 0 && (
          <div className="space-y-2">
            {inputs.user_actions.map((action, index) => (
              <UserActionItem
                key={index}
                data={action}
                onChange={data => handleUserActionChange(index, data)}
                onDelete={handleUserActionDelete}
                readonly={readOnly}
              />
            ))}
          </div>
        )}
      </div>
      <div className="px-4 py-2">
        <Divider className="!my-0 !h-px !bg-divider-subtle" />
      </div>
      {/* timeout */}
      <div className="flex items-center justify-between px-4 py-2">
        <div className="system-sm-semibold-uppercase text-text-secondary">{t(`${i18nPrefix}.timeout.title`, { ns: 'workflow' })}</div>
        <TimeoutInput
          timeout={inputs.timeout}
          unit={inputs.timeout_unit}
          onChange={handleTimeoutChange}
          readonly={readOnly}
        />
      </div>
      {/* output vars */}
      <Split />
      <OutputVars
        collapsed={structuredOutputCollapsed}
        onCollapse={setStructuredOutputCollapsed}
      >
        {
          inputs.inputs.map(input => (
            <VarItem
              key={input.output_variable_name}
              name={input.output_variable_name}
              type={VarType.string}
              description="Form input value"
            />
          ))
        }
        <VarItem
          name="__action_id"
          type="string"
          description="Action ID user triggered"
        />
        <VarItem
          name="__rendered_content"
          type="string"
          description="Rendered content"
        />
      </OutputVars>

      {isPreview && (
        <FormContentPreview
          content={inputs.form_content}
          formInputs={inputs.inputs}
          userActions={inputs.user_actions}
          onClose={hidePreview}
        />
      )}
    </div>
  )
}

export default React.memo(Panel)
