import type { FormInputItem, HumanInputSharedNodeType, UserAction } from './types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import { useId, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { useStore } from '@/app/components/workflow/store'
import { VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { isHumanInputV2NodeData } from '../../human-input-v2/types'
import FormContent from '../components/form-content'
import { FormContentPreviewTrigger } from '../components/form-content-preview'
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
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
}

const HumanInputSharedPanelSections = <T extends HumanInputSharedNodeType>({
  id,
  config,
  availableVars,
  availableNodes,
}: HumanInputSharedPanelSectionsProps<T>) => {
  const { t } = useTranslation(['workflow', 'workflowHumanInput', 'common', 'share'])
  const actionsLabelId = useId()
  const formContentLabelId = useId()
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
  const [isExpandFormContent, { toggle: toggleExpandFormContent }] = useBoolean(false)
  const nodePanelWidth = useStore((state) => state.nodePanelWidth)

  const addActionRef = useRef<HTMLButtonElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const actionFocusRef = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const index = actionFocusRef.current
    if (index === undefined) return
    actionFocusRef.current = undefined
    const input = actionsRef.current?.children[index]?.querySelector<HTMLInputElement>('input')
    if (input) input.focus()
    else addActionRef.current?.focus()
  }, [inputs.user_actions])
  const onAddUserAction = () => {
    const existingIds = new Set(inputs.user_actions.map((action) => action.id))
    let index = inputs.user_actions.length + 1
    while (existingIds.has(`action_${index}`)) index += 1
    handleUserActionAdd({
      id: `action_${index}`,
      title: t(($) => $[`${i18nPrefix}.userActions.defaultTitle`], {
        ns: 'workflowHumanInput',
        index,
      }),
      button_style: UserActionButtonType.Default,
    })
  }

  return (
    <>
      <div
        className={cn(
          'px-4 py-2',
          isExpandFormContent &&
            'fixed inset-e-1 top-61 bottom-2 z-10 flex flex-col rounded-b-2xl bg-components-panel-bg',
        )}
        style={{ width: isExpandFormContent ? nodePanelWidth : '100%' }}
      >
        <div className="mb-1 flex shrink-0 items-center justify-between">
          <div className="flex h-6 items-center gap-0.5">
            <div
              id={formContentLabelId}
              className="system-sm-semibold-uppercase text-text-secondary"
            >
              {t(($) => $[`${i18nPrefix}.formContent.title`], { ns: 'workflowHumanInput' })}
            </div>
            <Infotip>
              <InfotipTrigger aria-labelledby={formContentLabelId} />
              <InfotipContent aria-labelledby={formContentLabelId}>
                {t(($) => $[`${i18nPrefix}.formContent.tooltip`], { ns: 'workflowHumanInput' })}
              </InfotipContent>
            </Infotip>
          </div>
          {!readOnly && (
            <div className="flex items-center">
              <FormContentPreviewTrigger
                content={inputs.form_content}
                formInputs={inputs.inputs}
                userActions={inputs.user_actions}
                nodeId={isHumanInputV2NodeData(inputs) ? id : undefined}
              />
              <div className="mx-2 h-3 w-px bg-divider-regular" />
              <div className="flex items-center space-x-1">
                <IconButton
                  type="button"
                  aria-label={t(($) => $['operation.copy'], { ns: 'common' })}
                  onClick={() => {
                    copy(inputs.form_content)
                    toast.success(t(($) => $['actionMsg.copySuccessfully'], { ns: 'common' }))
                  }}
                >
                  <span className="i-ri-clipboard-line size-4 text-text-secondary" aria-hidden />
                </IconButton>
                <IconButton
                  type="button"
                  aria-label={t(($) => $[isExpandFormContent ? 'chat.collapse' : 'chat.expand'], {
                    ns: 'share',
                  })}
                  className={cn(
                    'text-text-secondary',
                    isExpandFormContent && 'bg-state-accent-active text-text-accent',
                  )}
                  onClick={toggleExpandFormContent}
                >
                  {isExpandFormContent ? (
                    <span className="i-ri-collapse-diagonal-line size-4" aria-hidden />
                  ) : (
                    <span className="i-ri-expand-diagonal-line size-4" aria-hidden />
                  )}
                </IconButton>
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
          availableNodes={availableNodes}
          readonly={readOnly}
        />
      </div>

      <div className="px-4 py-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <div id={actionsLabelId} className="system-sm-semibold-uppercase text-text-secondary">
              {t(($) => $[`${i18nPrefix}.userActions.title`], { ns: 'workflowHumanInput' })}
            </div>
            <Infotip>
              <InfotipTrigger aria-labelledby={actionsLabelId} />
              <InfotipContent aria-labelledby={actionsLabelId}>
                {t(($) => $[`${i18nPrefix}.userActions.tooltip`], { ns: 'workflowHumanInput' })}
              </InfotipContent>
            </Infotip>
          </div>
          {!readOnly && (
            <div className="flex items-center px-1">
              <IconButton
                ref={addActionRef}
                aria-label={t(($) => $['operation.add'], { ns: 'common' })}
                onClick={onAddUserAction}
              >
                <span className="i-ri-add-line size-4" aria-hidden />
              </IconButton>
            </div>
          )}
        </div>
        {!inputs.user_actions.length && (
          <div className="flex items-center justify-center rounded-[10px] bg-background-section p-3 system-xs-regular text-text-tertiary">
            {t(($) => $[`${i18nPrefix}.userActions.emptyTip`], { ns: 'workflowHumanInput' })}
          </div>
        )}
        {!!inputs.user_actions.length && (
          <div ref={actionsRef} className="space-y-2">
            {inputs.user_actions.map((action, index) => (
              <UserActionItem
                // oxlint-disable-next-line react/no-array-index-key -- Editable action IDs cannot provide stable keys while typing.
                key={`${id}-${index}`}
                data={action}
                onChange={(data) => handleUserActionChange(index, data)}
                onDelete={(actionId) => {
                  actionFocusRef.current = Math.max(
                    0,
                    Math.min(index, inputs.user_actions.length - 2),
                  )
                  handleUserActionDelete(actionId)
                }}
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
    </>
  )
}

export default HumanInputSharedPanelSections
