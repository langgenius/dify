'use client'
import type { FC } from 'react'
import type { HoverPopup } from './var-reference-picker.trigger'
import type { CredentialFormSchema, CredentialFormSchemaSelect, FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Tool } from '@/app/components/tools/types'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { CommonNodeType, Node, NodeOutPutVar, ToolWithProvider, ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { noop } from 'es-toolkit/function'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useNodes,
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useIsChatMode,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
// import type { BaseResource, BaseResourceProvider } from '@/app/components/workflow/nodes/_base/types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { useStore as useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import { useFetchDynamicOptions } from '@/service/use-plugins'
import useAvailableVarList from '../../hooks/use-available-var-list'
import { removeFileVars, varTypeToStructType } from './utils'
import VarFullPathPanel from './var-full-path-panel'
import {
  getDynamicSelectSchema,
  getHasValue,
  getIsIterationVar,
  getIsLoopVar,
  getOutputVarNode,
  getOutputVarNodeId,
  getTooltipContent,
  getVarDisplayName,
  getVariableCategory,
  getVariableMeta,
  getVarKindOptions,
  getWidthAllocations,
  isShowAPartSelector,
} from './var-reference-picker.helpers'
import VarReferencePickerTrigger from './var-reference-picker.trigger'
import VarReferencePopup from './var-reference-popup'

const TRIGGER_DEFAULT_WIDTH = 227

type Props = {
  className?: string
  nodeId: string
  isShowNodeName?: boolean
  readonly: boolean
  value: ValueSelector | string
  onChange: (value: ValueSelector | string, varKindType: VarKindType, varInfo?: Var) => void
  onOpen?: () => void
  isSupportConstantValue?: boolean
  defaultVarKindType?: VarKindType
  onlyLeafNodeVar?: boolean
  filterVar?: (payload: Var, valueSelector: ValueSelector) => boolean
  isFilterFileVar?: boolean
  availableNodes?: Node[]
  availableVars?: NodeOutPutVar[]
  isAddBtnTrigger?: boolean
  trigger?: React.ReactNode
  isJustShowValue?: boolean
  schema?: Partial<CredentialFormSchema>
  valueTypePlaceHolder?: string
  isInTable?: boolean
  onRemove?: () => void
  typePlaceHolder?: string
  isSupportFileVar?: boolean
  placeholder?: string
  minWidth?: number
  popupFor?: 'assigned' | 'toAssigned'
  currentTool?: Tool
  currentProvider?: ToolWithProvider | TriggerWithProvider
  preferSchemaType?: boolean
}

const DEFAULT_VALUE_SELECTOR: Props['value'] = []

const VarReferencePicker: FC<Props> = ({
  nodeId,
  readonly,
  className,
  isShowNodeName = true,
  value = DEFAULT_VALUE_SELECTOR,
  onOpen = noop,
  onChange,
  isSupportConstantValue,
  defaultVarKindType = VarKindType.constant,
  onlyLeafNodeVar,
  filterVar = () => true,
  isFilterFileVar,
  availableNodes: passedInAvailableNodes,
  availableVars: passedInAvailableVars,
  trigger,
  isJustShowValue,
  isAddBtnTrigger,
  schema,
  valueTypePlaceHolder,
  isInTable,
  onRemove,
  typePlaceHolder,
  isSupportFileVar = true,
  placeholder,
  minWidth,
  popupFor,
  currentTool,
  currentProvider,
  preferSchemaType,
}) => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const nodes = useNodes<CommonNodeType>()
  const isChatMode = useIsChatMode()
  const isWorkflowDataLoaded = useWorkflowStore(s => s.isWorkflowDataLoaded)
  const { getCurrentVariableType } = useWorkflowVariables()
  const { availableVars, availableNodesWithParent: availableNodes } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar,
    passedInAvailableNodes,
    filterVar,
  })

  const reactflow = useReactFlow()

  const startNode = availableNodes.find((node: Node) => {
    return node.data.type === BlockEnum.Start
  })

  const node = nodes.find(n => n.id === nodeId)
  const isInIteration = !!node?.data.isInIteration
  const iterationNode = isInIteration ? (nodes.find(n => n.id === node?.parentId) ?? null) : null

  const isInLoop = !!node?.data.isInLoop
  const loopNode = isInLoop ? (nodes.find(n => n.id === node?.parentId) ?? null) : null

  const triggerRef = useRef<HTMLDivElement>(null)
  const [triggerWidth, setTriggerWidth] = useState(TRIGGER_DEFAULT_WIDTH)
  useEffect(() => {
    if (triggerRef.current)
      setTriggerWidth(triggerRef.current.clientWidth)
  }, [])

  const [varKindType, setVarKindType] = useState<VarKindType>(defaultVarKindType)
  const isConstant = isSupportConstantValue && varKindType === VarKindType.constant

  const outputVars = useMemo(() => {
    const results = passedInAvailableVars || availableVars
    return isFilterFileVar ? removeFileVars(results) : results
  }, [passedInAvailableVars, availableVars, isFilterFileVar])

  const [open, setOpen] = useState(false)
  useEffect(() => {
    onOpen()
  }, [open, onOpen])
  const hasValue = getHasValue(!!isConstant, value)

  const isIterationVar = useMemo(
    () => getIsIterationVar(isInIteration, value, node?.parentId),
    [isInIteration, node?.parentId, value],
  )

  const isLoopVar = useMemo(
    () => getIsLoopVar(isInLoop, value, node?.parentId),
    [isInLoop, node?.parentId, value],
  )

  const outputVarNodeId = getOutputVarNodeId(hasValue, value)
  const outputVarNode = useMemo(() => getOutputVarNode({
    availableNodes,
    hasValue,
    isConstant: !!isConstant,
    isIterationVar,
    isLoopVar,
    iterationNode,
    loopNode,
    outputVarNodeId: outputVarNodeId!,
    startNode,
    value,
  }), [availableNodes, hasValue, isConstant, isIterationVar, isLoopVar, iterationNode, loopNode, outputVarNodeId, startNode, value])

  const isShowAPart = isShowAPartSelector(value)

  const varName = useMemo(
    () => getVarDisplayName(hasValue, value),
    [hasValue, value],
  )

  const varKindTypes = getVarKindOptions()

  const handleVarKindTypeChange = useCallback((value: VarKindType) => {
    setVarKindType(value)
    if (value === VarKindType.constant)
      onChange('', value)
    else
      onChange([], value)
  }, [onChange])

  const inputRef = useRef<HTMLInputElement>(null)
  const [controlFocus, setControlFocus] = useState(0)
  const isFocus = controlFocus > 0
  useEffect(() => {
    if (controlFocus && inputRef.current)
      inputRef.current.focus()
  }, [controlFocus])

  const handleVarReferenceChange = useCallback((value: ValueSelector, varInfo: Var) => {
    // sys var not passed to backend
    const newValue = produce(value, (draft) => {
      if (draft[1] && draft[1].startsWith('sys.')) {
        draft.shift()
        const paths = draft[0]!.split('.')
        paths.forEach((p, i) => {
          draft[i] = p
        })
      }
    })
    onChange(newValue, varKindType, varInfo)
    setOpen(false)
  }, [onChange, varKindType])

  const handleClearVar = useCallback(() => {
    if (varKindType === VarKindType.constant)
      onChange('', varKindType)
    else
      onChange([], varKindType)
  }, [onChange, varKindType])

  const handleVariableJump = useCallback((nodeId: string) => {
    const currentNodeIndex = availableNodes.findIndex(node => node.id === nodeId)
    const currentNode = availableNodes[currentNodeIndex]

    const workflowContainer = document.getElementById('workflow-container')
    const {
      clientWidth,
      clientHeight,
    } = workflowContainer!
    const {
      setViewport,
    } = reactflow
    const { transform } = store.getState()
    const zoom = transform[2]
    const position = currentNode!.position
    setViewport({
      x: (clientWidth - 400 - currentNode!.width! * zoom) / 2 - position.x * zoom,
      y: (clientHeight - currentNode!.height! * zoom) / 2 - position.y * zoom,
      zoom: transform[2],
    })
  }, [availableNodes, reactflow, store])

  const type = getCurrentVariableType({
    parentNode: isInIteration ? iterationNode : loopNode,
    valueSelector: value as ValueSelector,
    availableNodes,
    isChatMode,
    isConstant: !!isConstant,
    preferSchemaType,
  })

  const { isEnv, isChatVar, isGlobal, isRagVar, isValidVar } = useMemo(
    () => getVariableMeta(outputVarNode, value, varName, outputVars, isWorkflowDataLoaded),
    [isWorkflowDataLoaded, outputVarNode, outputVars, value, varName],
  )
  const isException = useMemo(
    () => isExceptionVariable(varName, outputVarNode?.type),
    [outputVarNode?.type, varName],
  )
  const showErrorIcon = hasValue && !isValidVar
  const shouldShowNodeName = isShowNodeName && !isEnv && !isChatVar && !isGlobal && !isRagVar
  const visibleNodeTitle = shouldShowNodeName ? outputVarNode?.title || '' : ''

  // 8(left/right-padding) + 14(icon) + 4 + 14 + 2 = 42 + 17 buff
  const {
    maxNodeNameWidth,
    maxTypeWidth,
    maxVarNameWidth,
  } = getWidthAllocations(triggerWidth, visibleNodeTitle, varName || '', type || '')

  const hoverPopup = useMemo<HoverPopup | null>(() => {
    const tooltipType = getTooltipContent(hasValue, isShowAPart, isValidVar)
    if (tooltipType === 'full-path') {
      return {
        kind: 'full-path',
        panel: (
          <VarFullPathPanel
            nodeName={outputVarNode?.title}
            path={(value as ValueSelector).slice(1)}
            varType={varTypeToStructType(type)}
            nodeType={outputVarNode?.type}
          />
        ),
      }
    }
    if (tooltipType === 'invalid-variable')
      return { kind: 'invalid-variable', message: t('errorMsg.invalidVariable', { ns: 'workflow' }) }

    return null
  }, [isValidVar, isShowAPart, hasValue, t, outputVarNode?.title, outputVarNode?.type, value, type])

  const [dynamicOptions, setDynamicOptions] = useState<FormOption[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { mutateAsync: fetchDynamicOptions } = useFetchDynamicOptions(
    currentProvider?.plugin_id || '',
    currentProvider?.name || '',
    currentTool?.name || '',
    (schema as CredentialFormSchemaSelect)?.variable || '',
    'tool',
  )
  const handleFetchDynamicOptions = useCallback(async () => {
    if (schema?.type !== FormTypeEnum.dynamicSelect || !currentTool || !currentProvider)
      return
    setIsLoading(true)
    try {
      const data = await fetchDynamicOptions()
      setDynamicOptions(data?.options || [])
    }
    finally {
      setIsLoading(false)
    }
  }, [currentProvider, currentTool, fetchDynamicOptions, schema?.type])
  useEffect(() => {
    handleFetchDynamicOptions()
  }, [handleFetchDynamicOptions])

  const schemaWithDynamicSelect = useMemo(
    () => getDynamicSelectSchema({ dynamicOptions, isLoading, schema, value }),
    [dynamicOptions, isLoading, schema, value],
  )

  const variableCategory = useMemo(
    () => getVariableCategory({ isChatVar, isEnv, isGlobal, isLoopVar, isRagVar }),
    [isChatVar, isEnv, isGlobal, isLoopVar, isRagVar],
  )

  const triggerPlaceholder = placeholder ?? t('common.setVarValuePlaceholder', { ns: 'workflow' })
  const resolvedTrigger = React.isValidElement(trigger) ? trigger : <div>{trigger}</div>

  return (
    <div className={cn(className)}>
      <Popover
        open={open}
        onOpenChange={setOpen}
      >
        {!!trigger && (
          <PopoverTrigger
            render={resolvedTrigger}
            onClick={(e) => {
              if (readonly)
                e.preventDefault()
            }}
          />
        )}
        {!trigger && (
          <VarReferencePickerTrigger
            className={className}
            controlFocus={controlFocus}
            currentProvider={currentProvider}
            currentTool={currentTool}
            handleClearVar={handleClearVar}
            handleVarKindTypeChange={handleVarKindTypeChange}
            handleVariableJump={handleVariableJump}
            hasValue={hasValue}
            inputRef={inputRef}
            isAddBtnTrigger={isAddBtnTrigger}
            isConstant={!!isConstant}
            isException={isException}
            isFocus={isFocus}
            isInTable={isInTable}
            isJustShowValue={isJustShowValue}
            isLoading={isLoading}
            isShowAPart={isShowAPart}
            isShowNodeName={shouldShowNodeName}
            isSupportConstantValue={isSupportConstantValue}
            maxNodeNameWidth={maxNodeNameWidth}
            maxTypeWidth={maxTypeWidth}
            maxVarNameWidth={maxVarNameWidth}
            onChange={onChange}
            onRemove={onRemove}
            open={open}
            outputVarNode={outputVarNode as Node['data'] | null}
            outputVarNodeId={outputVarNodeId}
            placeholder={triggerPlaceholder}
            readonly={readonly}
            schemaWithDynamicSelect={schemaWithDynamicSelect}
            setControlFocus={setControlFocus}
            setOpen={setOpen}
            showErrorIcon={showErrorIcon}
            hoverPopup={hoverPopup}
            triggerRef={triggerRef}
            type={type}
            typePlaceHolder={typePlaceHolder}
            value={value}
            valueTypePlaceHolder={valueTypePlaceHolder}
            varKindType={varKindType}
            varKindTypes={varKindTypes}
            varName={varName}
            variableCategory={variableCategory}
          />
        )}
        <PopoverContent
          placement={isAddBtnTrigger ? 'bottom-end' : 'bottom-start'}
          sideOffset={0}
          className="mt-1"
          popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
        >
          {!isConstant && (
            <VarReferencePopup
              vars={outputVars}
              popupFor={popupFor}
              onChange={handleVarReferenceChange}
              itemWidth={isAddBtnTrigger ? 260 : (minWidth || triggerWidth)}
              isSupportFileVar={isSupportFileVar}
              preferSchemaType={preferSchemaType}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
export default React.memo(VarReferencePicker)
