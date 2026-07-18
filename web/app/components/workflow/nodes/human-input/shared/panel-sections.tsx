import type { FormInputItem, HumanInputSharedNodeType, UserAction } from './types'
import type { Var } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { Infotip } from '@/app/components/base/infotip'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { useStore } from '@/app/components/workflow/store'
import { VarType } from '@/app/components/workflow/types'
import FormContent from '../components/form-content'
import FormContentPreview from '../components/form-content-preview'
import TimeoutInput from '../components/timeout'
import UserActionItem from '../components/user-action'
import { UserActionButtonType } from './types'

const i18nPrefix = 'nodes.humanInput'

const getOutputVarType = (input: FormInputItem): VarType => {
  if (input.type === 'file') return VarType.file
  if (input.type === 'file-list') return VarType.arrayFile
  return VarType.string
}

export type HumanInputSharedPanelConfig<T extends HumanInputSharedNodeType> = {
  readOnly: boolean
  inputs: T
  editorKey: number
  structuredOutputCollapsed: boolean
  setStructuredOutputCollapsed: (collapsed: boolean) => void
  handleUserActionAdd: (action: UserAction) => void
  handleUserActionChange: (index: number, action: UserAction) => void
  handleUserActionDelete: (actionId: string) => void
  handleTimeoutChange: (value: { timeout: number; unit: 'hour' | 'day' }) => void
  handleFormContentChange: (value: string) => void
  handleFormInputsChange: (inputs: FormInputItem[]) => void
  handleFormInputItemRename: (input: FormInputItem, oldName: string) => void
  handleFormInputItemRemove: (name: string) => void
}

type HumanInputSharedPanelSectionsProps<T extends HumanInputSharedNodeType> = {
  id: string
  config: HumanInputSharedPanelConfig<T>
}

const HumanInputSharedPanelSections = <T extends HumanInputSharedNodeType>({
  id,
  config,
}: HumanInputSharedPanelSectionsProps<T>) => {
  const { t } = useTranslation()
  const {
    readOnly,
    inputs,
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
  } = config
  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) =>
      [VarType.string, VarType.number, VarType.secret, VarType.arrayString].includes(
        varPayload.type,
      ),
  })
  const [isExpandFormContent, { toggle: toggleExpandFormContent }] = useBoolean(false)
  const [isPreview, { toggle: togglePreview, setFalse: hidePreview }] = useBoolean(false)
  const nodePanelWidth = useStore((state) => state.nodePanelWidth)

  const onAddUserAction = useCallback(() => {
    const index = inputs.user_actions.length + 1
    handleUserActionAdd({
      id: `action_${index}`,
      title: t(($) => $[`${i18nPrefix}.userActions.defaultTitle`], {
        ns: 'workflow',
        index,
      }),
      button_style: UserActionButtonType.Default,
    })
  }, [handleUserActionAdd, inputs.user_actions.length, t])

  return (
    <>
      <div
        className={cn(
          'px-4 py-2',
          isExpandFormContent &&
            'fixed top-[244px] right-[4px] bottom-[8px] z-10 flex flex-col rounded-b-2xl bg-components-panel-bg',
        )}
        style={{ width: isExpandFormContent ? nodePanelWidth : '100%' }}
      >
        <div className="mb-1 flex shrink-0 items-center justify-between">
          <div className="flex h-6 items-center gap-0.5">
            <div className="system-sm-semibold-uppercase text-text-secondary">
              {t(($) => $[`${i18nPrefix}.formContent.title`], { ns: 'workflow' })}
            </div>
            <Infotip
              aria-label={t(($) => $[`${i18nPrefix}.formContent.tooltip`], { ns: 'workflow' })}
            >
              {t(($) => $[`${i18nPrefix}.formContent.tooltip`], { ns: 'workflow' })}
            </Infotip>
          </div>
          {!readOnly && (
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="small"
                className={cn(
                  'flex items-center space-x-1 px-2',
                  isPreview && 'bg-state-accent-active text-text-accent',
                )}
                onClick={togglePreview}
              >
                <span className="i-ri-eye-line size-3.5" aria-hidden />
                <span className="system-xs-medium">
                  {t(($) => $[`${i18nPrefix}.formContent.preview`], { ns: 'workflow' })}
                </span>
              </Button>
              <div className="mx-2 h-3 w-px bg-divider-regular" />
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  aria-label={t(($) => $['operation.copy'], { ns: 'common' })}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-0 hover:bg-components-button-ghost-bg-hover focus-visible:ring-1 focus-visible:ring-components-button-secondary-accent-border"
                  onClick={() => {
                    copy(inputs.form_content)
                    toast.success(t(($) => $['actionMsg.copySuccessfully'], { ns: 'common' }))
                  }}
                >
                  <span className="i-ri-clipboard-line size-4 text-text-secondary" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t(($) => $[isExpandFormContent ? 'chat.collapse' : 'chat.expand'], {
                    ns: 'share',
                  })}
                  className={cn(
                    'flex size-6 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-0 text-text-secondary hover:bg-components-button-ghost-bg-hover focus-visible:ring-1 focus-visible:ring-components-button-secondary-accent-border',
                    isExpandFormContent && 'bg-state-accent-active text-text-accent',
                  )}
                  onClick={toggleExpandFormContent}
                >
                  {isExpandFormContent ? (
                    <span className="i-ri-collapse-diagonal-line size-4" aria-hidden />
                  ) : (
                    <span className="i-ri-expand-diagonal-line size-4" aria-hidden />
                  )}
                </button>
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

      <div className="px-4 py-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <div className="system-sm-semibold-uppercase text-text-secondary">
              {t(($) => $[`${i18nPrefix}.userActions.title`], { ns: 'workflow' })}
            </div>
            <Infotip
              aria-label={t(($) => $[`${i18nPrefix}.userActions.tooltip`], { ns: 'workflow' })}
            >
              {t(($) => $[`${i18nPrefix}.userActions.tooltip`], { ns: 'workflow' })}
            </Infotip>
          </div>
          {!readOnly && (
            <div className="flex items-center px-1">
              <ActionButton
                aria-label={t(($) => $[`${i18nPrefix}.userActions.add`], { ns: 'workflow' })}
                onClick={onAddUserAction}
              >
                <span className="i-ri-add-line size-4" aria-hidden />
              </ActionButton>
            </div>
          )}
        </div>
        {!inputs.user_actions.length && (
          <div className="flex items-center justify-center rounded-[10px] bg-background-section p-3 system-xs-regular text-text-tertiary">
            {t(($) => $[`${i18nPrefix}.userActions.emptyTip`], { ns: 'workflow' })}
          </div>
        )}
        {!!inputs.user_actions.length && (
          <div className="space-y-2">
            {inputs.user_actions.map((action, index) => (
              <UserActionItem
                key={action.id || index}
                data={action}
                onChange={(data) => handleUserActionChange(index, data)}
                onDelete={handleUserActionDelete}
                readonly={readOnly}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-2">
        <div className="system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $[`${i18nPrefix}.timeout.title`], { ns: 'workflow' })}
        </div>
        <TimeoutInput
          timeout={inputs.timeout}
          unit={inputs.timeout_unit}
          onChange={handleTimeoutChange}
          readonly={readOnly}
        />
      </div>

      <Split />
      <OutputVars collapsed={structuredOutputCollapsed} onCollapse={setStructuredOutputCollapsed}>
        {inputs.inputs.map((input) => (
          <VarItem
            key={input.output_variable_name}
            name={input.output_variable_name}
            type={getOutputVarType(input)}
            description={t(($) => $[`${i18nPrefix}.output.formInput`], { ns: 'workflow' })}
          />
        ))}
        <VarItem
          name="__action_id"
          type="string"
          description={t(($) => $[`${i18nPrefix}.output.actionId`], { ns: 'workflow' })}
        />
        <VarItem
          name="__action_value"
          type="string"
          description={t(($) => $[`${i18nPrefix}.output.actionValue`], { ns: 'workflow' })}
        />
        <VarItem
          name="__rendered_content"
          type="string"
          description={t(($) => $[`${i18nPrefix}.output.renderedContent`], { ns: 'workflow' })}
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
    </>
  )
}

export default HumanInputSharedPanelSections
