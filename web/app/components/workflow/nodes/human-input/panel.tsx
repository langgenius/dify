import type { FC } from 'react'
import React from 'react'
import {
  RiAddLine,
  RiClipboardLine,
  RiCollapseDiagonalLine,
  RiExpandDiagonalLine,
  RiEyeLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import type { HumanInputNodeType } from './types'
import { UserActionButtonType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import Divider from '@/app/components/base/divider'
import DeliveryMethod from './components/delivery-method'
import UserActionItem from './components/user-action'
import TimeoutInput from './components/timeout'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { VarType } from '@/app/components/workflow/types'
import type { Var } from '@/app/components/workflow/types'
import FormContent from './components/form-content'
import { genActionId } from './utils'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import copy from 'copy-to-clipboard'
import { useBoolean } from 'ahooks'
import cn from '@/utils/classnames'
import { useStore } from '@/app/components/workflow/store'

const i18nPrefix = 'workflow.nodes.humanInput'

const Panel: FC<NodePanelProps<HumanInputNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
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
  } = useConfig(id, data)

  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    },
  })

  const [isExpandFormContent, {
    toggle: toggleExpandFormContent,
  }] = useBoolean(true)
  const panelWidth = useStore(state => state.panelWidth)

  return (
    <div className='py-2'>
      {/* delivery methods */}
      <DeliveryMethod
        value={inputs.delivery_methods || []}
        nodesOutputVars={availableVars}
        availableNodes={availableNodesWithParent}
        onChange={handleDeliveryMethodChange}
      />
      <div className='px-4 py-2'>
        <Divider className='!my-0 !h-px !bg-divider-subtle' />
      </div>
      {/* form content */}
      <div className={cn('px-4 py-2', isExpandFormContent && 'fixed bottom-[8px] right-[4px] top-[189px] z-10 flex flex-col bg-components-panel-bg')} style={{ width: panelWidth }}>
        <div className='mb-1 flex shrink-0 items-center justify-between'>
          <div className='flex h-6 items-center gap-0.5'>
            <div className='system-sm-semibold-uppercase text-text-secondary'>{t(`${i18nPrefix}.formContent.title`)}</div>
            <Tooltip
              popupContent={t(`${i18nPrefix}.formContent.tooltip`)}
            />
          </div>
          <div className='flex items-center '>
            <Button variant='ghost' className='flex items-center space-x-1 px-2 text-components-button-ghost-text'>
              <RiEyeLine className='size-3.5' />
              <div className='system-xs-medium'>Preview</div>
            </Button>
            <div className='ml-3 mr-2 h-3 w-px bg-divider-regular'></div>
            <div className='flex items-center space-x-1'>
              <div className='flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-components-button-ghost-bg-hover' onClick={() => {
                copy(inputs.form_content)
                Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
              }}>
                <RiClipboardLine className='h-4 w-4 text-text-secondary' />
              </div>
              <div className={cn('flex size-6 cursor-pointer items-center justify-center rounded-md text-text-secondary hover:bg-components-button-ghost-bg-hover', isExpandFormContent && 'bg-state-accent-active text-text-accent')} onClick={toggleExpandFormContent}>
                {isExpandFormContent ? <RiCollapseDiagonalLine className='h-4 w-4' /> : <RiExpandDiagonalLine className='h-4 w-4' />}
              </div>
            </div>
          </div>
        </div>
        <FormContent
          editorKey={editorKey}
          nodeId={id}
          value={inputs.form_content}
          onChange={handleFormContentChange}
          nodeTitle={inputs.title}
          formInputs={inputs.inputs}
          onFormInputsChange={handleFormInputsChange}
          onFormInputItemRename={handleFormInputItemRename}
          onFormInputItemRemove={handleFormInputItemRemove}
          isExpand={isExpandFormContent}
        />
      </div>
      {/* user actions */}
      <div className='px-4 py-2'>
        <div className='mb-1 flex items-center justify-between'>
          <div className='flex items-center gap-0.5'>
            <div className='system-sm-semibold-uppercase text-text-secondary'>{t(`${i18nPrefix}.userActions.title`)}</div>
            <Tooltip
              popupContent={t(`${i18nPrefix}.userActions.tooltip`)}
            />
          </div>
          <div className='flex items-center px-1'>
            <ActionButton
              onClick={() => {
                handleUserActionAdd({
                  id: genActionId(),
                  title: 'Button Text',
                  button_style: UserActionButtonType.Default,
                })
              }}
            >
              <RiAddLine className='h-4 w-4' />
            </ActionButton>
          </div>
        </div>
        {!inputs.user_actions.length && (
          <div className='system-xs-regular flex items-center justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary'>{t(`${i18nPrefix}.userActions.emptyTip`)}</div>
        )}
        {inputs.user_actions.length > 0 && (
          <div className='space-y-2'>
            {inputs.user_actions.map((action, index) => (
              <UserActionItem
                key={index}
                data={action}
                onChange={data => handleUserActionChange(index, data)}
                onDelete={handleUserActionDelete}
              />
            ))}
          </div>
        )}
      </div>
      <div className='px-4 py-2'>
        <Divider className='!my-0 !h-px !bg-divider-subtle' />
      </div>
      {/* timeout */}
      <div className='flex items-center justify-between px-4 py-2'>
        <div className='system-sm-semibold-uppercase text-text-secondary'>{t(`${i18nPrefix}.timeout.title`)}</div>
        <TimeoutInput
          timeout={inputs.timeout}
          unit={inputs.timeout_unit}
          onChange={handleTimeoutChange}
        />
      </div>
    </div>
  )
}

export default React.memo(Panel)
