'use client'

import type { FC, ReactNode } from 'react'
import type { VarType as VarKindType } from '../../../tool/types'
import type { CredentialFormSchema, CredentialFormSchemaSelect } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Tool } from '@/app/components/tools/types'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { Node, ToolWithProvider, ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowDownSLine, RiCloseLine, RiErrorWarningFill, RiLoader4Line, RiMoreLine } from '@remixicon/react'
import Badge from '@/app/components/base/badge'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'
import { VariableIconWithColor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import RemoveButton from '../remove-button'
import ConstantField from './constant-field'

type Props = {
  className?: string
  controlFocus: number
  currentProvider?: ToolWithProvider | TriggerWithProvider
  currentTool?: Tool
  handleClearVar: () => void
  handleVarKindTypeChange: (value: VarKindType) => void
  handleVariableJump: (nodeId: string) => void
  hasValue: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  inTable?: boolean
  isAddBtnTrigger?: boolean
  isConstant: boolean
  isException: boolean
  isFocus: boolean
  isInTable?: boolean
  isJustShowValue?: boolean
  isLoading: boolean
  isShowAPart: boolean
  isShowNodeName: boolean
  isSupportConstantValue?: boolean
  maxNodeNameWidth: number
  maxTypeWidth: number
  maxVarNameWidth: number
  onChange: (value: ValueSelector | string, varKindType: VarKindType, varInfo?: Var) => void
  onRemove?: () => void
  open: boolean
  outputVarNode?: Node['data'] | null
  outputVarNodeId?: string
  placeholder?: string
  readonly: boolean
  schemaWithDynamicSelect?: Partial<CredentialFormSchema>
  setControlFocus: (value: number) => void
  setOpen: (value: boolean) => void
  showErrorIcon?: boolean
  tooltipPopup: ReactNode
  triggerRef: React.RefObject<HTMLDivElement | null>
  type?: string
  typePlaceHolder?: string
  value: ValueSelector | string
  valueTypePlaceHolder?: string
  varKindType: VarKindType
  varKindTypes: Array<{ label: string, value: VarKindType }>
  varName: string
  variableCategory: string
  WrapElem: React.ElementType
  VarPickerWrap: React.ElementType
}

const VarReferencePickerTrigger: FC<Props> = ({
  className,
  controlFocus,
  handleClearVar,
  handleVarKindTypeChange,
  handleVariableJump,
  hasValue,
  inputRef,
  isAddBtnTrigger,
  isConstant,
  isException,
  isFocus,
  isInTable,
  isJustShowValue,
  isLoading,
  isShowAPart,
  isShowNodeName,
  isSupportConstantValue,
  maxNodeNameWidth,
  maxTypeWidth,
  maxVarNameWidth,
  onChange,
  onRemove,
  open,
  outputVarNode,
  outputVarNodeId,
  placeholder,
  readonly,
  schemaWithDynamicSelect,
  setControlFocus,
  setOpen,
  showErrorIcon = false,
  tooltipPopup,
  triggerRef,
  type,
  typePlaceHolder,
  value,
  valueTypePlaceHolder,
  varKindType,
  varKindTypes,
  varName,
  variableCategory,
  VarPickerWrap,
  WrapElem,
}) => {
  return (
    <WrapElem
      onClick={() => {
        if (readonly)
          return
        if (!isConstant)
          setOpen(!open)
        else
          setControlFocus(Date.now())
      }}
      className={cn(className, 'group/picker-trigger-wrap relative flex!', !readonly && 'cursor-pointer')}
      data-testid="var-reference-picker-trigger"
    >
      <>
        {isAddBtnTrigger
          ? (
              <div>
                <div className="cursor-pointer rounded-md p-1 select-none hover:bg-state-base-hover" onClick={() => {}} data-testid="add-button">
                  <span className="i-ri-add-line h-4 w-4 text-text-tertiary" />
                </div>
              </div>
            )
          : (
              <div ref={!isSupportConstantValue ? triggerRef : null} className={cn((open || isFocus) ? 'border-gray-300' : 'border-gray-100', 'group/wrap relative flex h-8 w-full items-center', !isSupportConstantValue && 'rounded-lg bg-components-input-bg-normal p-1', isInTable && 'border-none bg-transparent', readonly && 'bg-components-input-bg-disabled', isJustShowValue && 'h-6 bg-transparent p-0')}>
                {isSupportConstantValue
                  ? (
                      <div
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpen(false)
                          setControlFocus(Date.now())
                        }}
                        className="mr-1 flex h-full items-center space-x-1"
                      >
                        <TypeSelector
                          noLeft
                          trigger={(
                            <div className="flex h-8 items-center rounded-lg bg-components-input-bg-normal px-2">
                              <div className="mr-1 system-sm-regular text-components-input-text-filled">{varKindTypes.find(item => item.value === varKindType)?.label}</div>
                              <RiArrowDownSLine className="h-4 w-4 text-text-quaternary" />
                            </div>
                          )}
                          popupClassName="top-8"
                          readonly={readonly}
                          value={varKindType}
                          options={varKindTypes}
                          onChange={handleVarKindTypeChange}
                          showChecked
                        />
                      </div>
                    )
                  : (!hasValue && (
                      <div className="mr-1 ml-1.5">
                        <Variable02 className={`h-4 w-4 ${readonly ? 'text-components-input-text-disabled' : 'text-components-input-text-placeholder'}`} />
                      </div>
                    ))}
                {isConstant
                  ? (
                      <ConstantField
                        value={value as string}
                        onChange={onChange as ((value: string | number, varKindType: VarKindType, varInfo?: Var) => void)}
                        schema={schemaWithDynamicSelect as CredentialFormSchemaSelect}
                        readonly={readonly}
                        isLoading={isLoading}
                      />
                    )
                  : (
                      <VarPickerWrap
                        onClick={() => {
                          if (readonly)
                            return
                          if (!isConstant)
                            setOpen(!open)
                          else
                            setControlFocus(Date.now())
                        }}
                        className="h-full grow"
                      >
                        <div ref={isSupportConstantValue ? triggerRef : null} className={cn('h-full', isSupportConstantValue && 'flex items-center rounded-lg bg-components-panel-bg py-1 pl-1')}>
                          <Tooltip>
                            <TooltipTrigger
                              disabled={!tooltipPopup}
                              render={(
                                <div className={cn('h-full items-center rounded-[5px] px-1.5', hasValue ? 'inline-flex bg-components-badge-white-to-dark' : 'flex')}>
                                  {hasValue
                                    ? (
                                        <>
                                          {isShowNodeName && (
                                            <div
                                              className="flex items-center"
                                              onClick={(e) => {
                                                if (e.metaKey || e.ctrlKey)
                                                  handleVariableJump(outputVarNodeId || '')
                                              }}
                                            >
                                              <div className="h-3 px-px">
                                                {'type' in (outputVarNode || {}) && outputVarNode?.type && (
                                                  <VarBlockIcon
                                                    type={outputVarNode.type}
                                                    className="text-text-primary"
                                                  />
                                                )}
                                              </div>
                                              <div
                                                className="mx-0.5 truncate text-xs font-medium text-text-secondary"
                                                title={outputVarNode?.title as string | undefined}
                                                style={{ maxWidth: maxNodeNameWidth }}
                                              >
                                                {outputVarNode?.title as string | undefined}
                                              </div>
                                              <Line3 className="mr-0.5"></Line3>
                                            </div>
                                          )}
                                          {isShowAPart && (
                                            <div className="flex items-center">
                                              <RiMoreLine className="h-3 w-3 text-text-secondary" />
                                              <Line3 className="mr-0.5 text-divider-deep"></Line3>
                                            </div>
                                          )}
                                          <div className="flex items-center text-text-accent">
                                            {isLoading && <RiLoader4Line className="h-3.5 w-3.5 animate-spin text-text-secondary" />}
                                            <VariableIconWithColor
                                              variables={value as ValueSelector}
                                              variableCategory={variableCategory}
                                              isExceptionVariable={isException}
                                            />
                                            <div
                                              className={cn('ml-0.5 truncate text-xs font-medium', isException && 'text-text-warning')}
                                              title={varName}
                                              style={{ maxWidth: maxVarNameWidth }}
                                            >
                                              {varName}
                                            </div>
                                          </div>
                                          <div
                                            className="ml-0.5 truncate text-center system-xs-regular text-text-tertiary capitalize"
                                            title={type}
                                            style={{ maxWidth: maxTypeWidth }}
                                          >
                                            {type}
                                          </div>
                                          {showErrorIcon && <RiErrorWarningFill data-testid="var-reference-picker-error-icon" className="ml-0.5 h-3 w-3 text-text-destructive" />}
                                        </>
                                      )
                                    : (
                                        <div className={`overflow-hidden ${readonly ? 'text-components-input-text-disabled' : 'text-components-input-text-placeholder'} system-sm-regular text-ellipsis`}>
                                          {isLoading
                                            ? (
                                                <div className="flex items-center">
                                                  <RiLoader4Line className="mr-1 h-3.5 w-3.5 animate-spin text-text-secondary" />
                                                  <span>{placeholder}</span>
                                                </div>
                                              )
                                            : placeholder}
                                        </div>
                                      )}
                                </div>
                              )}
                            />
                            {tooltipPopup !== null && tooltipPopup !== undefined && (
                              <TooltipContent variant="plain">
                                {tooltipPopup}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </div>

                      </VarPickerWrap>
                    )}
                {(hasValue && !readonly && !isInTable && !isJustShowValue) && (
                  <div
                    className="group invisible absolute top-[50%] right-1 h-5 translate-y-[-50%] cursor-pointer rounded-md p-1 group-hover/wrap:visible hover:bg-state-base-hover"
                    onClick={handleClearVar}
                    data-testid="var-reference-picker-clear"
                  >
                    <RiCloseLine className="h-3.5 w-3.5 text-text-tertiary group-hover:text-text-secondary" />
                  </div>
                )}
                {!hasValue && valueTypePlaceHolder && (
                  <Badge
                    className="absolute top-[50%] right-1 translate-y-[-50%] capitalize"
                    text={valueTypePlaceHolder}
                    uppercase={false}
                  />
                )}
              </div>
            )}
        {!readonly && isInTable && (
          <RemoveButton
            className="absolute top-0.5 right-1 hidden group-hover/picker-trigger-wrap:block"
            onClick={() => onRemove?.()}
          />
        )}

        {!hasValue && typePlaceHolder && (
          <Badge
            className="absolute top-1.5 right-2"
            text={typePlaceHolder}
            uppercase={false}
          />
        )}
      </>
      <input ref={inputRef} className="sr-only" value={controlFocus} readOnly />
    </WrapElem>
  )
}

export default VarReferencePickerTrigger
