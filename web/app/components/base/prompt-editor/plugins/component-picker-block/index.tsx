import {
  Fragment,
  memo,
  useCallback,
  useState,
} from 'react'
import ReactDOM from 'react-dom'
import {
  flip,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react'
import type { TextNode } from 'lexical'
import type { MenuRenderFn } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type {
  ContextBlockType,
  CurrentBlockType,
  ErrorMessageBlockType,
  ExternalToolBlockType,
  HistoryBlockType,
  LastRunBlockType,
  QueryBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from '../../types'
import { useBasicTypeaheadTriggerMatch } from '../../hooks'
import { INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND } from '../workflow-variable-block'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '../variable-block'
import { $splitNodeContainingQuery } from '../../utils'
import { useOptions } from './hooks'
import type { PickerBlockMenuOption } from './menu'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { KEY_ESCAPE_COMMAND } from 'lexical'
import { INSERT_CURRENT_BLOCK_COMMAND } from '../current-block'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { INSERT_ERROR_MESSAGE_BLOCK_COMMAND } from '../error-message-block'
import { INSERT_LAST_RUN_BLOCK_COMMAND } from '../last-run-block'

type ComponentPickerProps = {
  triggerString: string
  contextBlock?: ContextBlockType
  queryBlock?: QueryBlockType
  historyBlock?: HistoryBlockType
  variableBlock?: VariableBlockType
  externalToolBlock?: ExternalToolBlockType
  workflowVariableBlock?: WorkflowVariableBlockType
  currentBlock?: CurrentBlockType
  errorMessageBlock?: ErrorMessageBlockType
  lastRunBlock?: LastRunBlockType
  isSupportFileVar?: boolean
}
const ComponentPicker = ({
  triggerString,
  contextBlock,
  queryBlock,
  historyBlock,
  variableBlock,
  externalToolBlock,
  workflowVariableBlock,
  currentBlock,
  errorMessageBlock,
  lastRunBlock,
  isSupportFileVar,
}: ComponentPickerProps) => {
  const { eventEmitter } = useEventEmitterContextContext()
  const { refs, floatingStyles, isPositioned } = useFloating({
    placement: 'bottom-start',
    middleware: [
      offset(0), // fix hide cursor
      shift({
        padding: 8,
      }),
      flip(),
    ],
  })
  const [editor] = useLexicalComposerContext()
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch(triggerString, {
    minLength: 0,
    maxLength: 0,
  })

  const [queryString, setQueryString] = useState<string | null>(null)

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === INSERT_VARIABLE_VALUE_BLOCK_COMMAND)
      editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, `{{${v.payload}}}`)
  })

  const {
    allFlattenOptions,
    workflowVariableOptions,
  } = useOptions(
    contextBlock,
    queryBlock,
    historyBlock,
    variableBlock,
    externalToolBlock,
    workflowVariableBlock,
    currentBlock,
    errorMessageBlock,
    lastRunBlock,
  )

  const onSelectOption = useCallback(
    (
      selectedOption: PickerBlockMenuOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        if (nodeToRemove && selectedOption?.key)
          nodeToRemove.remove()

        selectedOption.onSelectMenuOption()
        closeMenu()
      })
    },
    [editor],
  )

  const handleSelectWorkflowVariable = useCallback((variables: string[]) => {
    editor.update(() => {
      const needRemove = $splitNodeContainingQuery(checkForTriggerMatch(triggerString, editor)!)
      if (needRemove)
        needRemove.remove()
    })
    const isFlat = variables.length === 1
    if (isFlat) {
      const varName = variables[0]
      if (varName === 'current')
        editor.dispatchCommand(INSERT_CURRENT_BLOCK_COMMAND, currentBlock?.generatorType)
      else if (varName === 'error_message')
        editor.dispatchCommand(INSERT_ERROR_MESSAGE_BLOCK_COMMAND, null)
      else if (varName === 'last_run')
        editor.dispatchCommand(INSERT_LAST_RUN_BLOCK_COMMAND, null)
    }
    else if (variables[1] === 'sys.query' || variables[1] === 'sys.files') {
      editor.dispatchCommand(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, [variables[1]])
    }
    else {
      editor.dispatchCommand(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, variables)
    }
  }, [editor, currentBlock?.generatorType, checkForTriggerMatch, triggerString])

  const handleClose = useCallback(() => {
    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' })
    editor.dispatchCommand(KEY_ESCAPE_COMMAND, escapeEvent)
  }, [editor])

  const renderMenu = useCallback<MenuRenderFn<PickerBlockMenuOption>>((
    anchorElementRef,
    { options, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
  ) => {
    if (!(anchorElementRef.current && (allFlattenOptions.length || workflowVariableBlock?.show)))
      return null

    setTimeout(() => {
      if (anchorElementRef.current)
        refs.setReference(anchorElementRef.current)
    }, 0)

    return (
      <>
        {
          ReactDOM.createPortal(
            // The `LexicalMenu` will try to calculate the position of the floating menu based on the first child.
            // Since we use floating ui, we need to wrap it with a div to prevent the position calculation being affected.
            // See https://github.com/facebook/lexical/blob/ac97dfa9e14a73ea2d6934ff566282d7f758e8bb/packages/lexical-react/src/shared/LexicalMenu.ts#L493
            <div className='h-0 w-0'>
              <div
                className='w-[260px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg'
                style={{
                  ...floatingStyles,
                  visibility: isPositioned ? 'visible' : 'hidden',
                }}
                ref={refs.setFloating}
              >
                {
                  workflowVariableBlock?.show && (
                    <div className='p-1'>
                      <VarReferenceVars
                        searchBoxClassName='mt-1'
                        vars={workflowVariableOptions}
                        onChange={(variables: string[]) => {
                          handleSelectWorkflowVariable(variables)
                        }}
                        maxHeightClass='max-h-[34vh]'
                        isSupportFileVar={isSupportFileVar}
                        onClose={handleClose}
                        onBlur={handleClose}
                        showManageInputField={workflowVariableBlock.showManageInputField}
                        onManageInputField={workflowVariableBlock.onManageInputField}
                        autoFocus={false}
                        isInCodeGeneratorInstructionEditor={currentBlock?.generatorType === GeneratorType.code}
                      />
                    </div>
                  )
                }
                {
                  workflowVariableBlock?.show && !!options.length && (
                    <div className='my-1 h-px w-full -translate-x-1 bg-divider-subtle'></div>
                  )
                }
                <div>
                  {
                    options.map((option, index) => (
                      <Fragment key={option.key}>
                        {
                          // Divider
                          index !== 0 && options.at(index - 1)?.group !== option.group && (
                            <div className='my-1 h-px w-full -translate-x-1 bg-divider-subtle'></div>
                          )
                        }
                        {option.renderMenuOption({
                          queryString,
                          isSelected: selectedIndex === index,
                          onSelect: () => {
                            selectOptionAndCleanUp(option)
                          },
                          onSetHighlight: () => {
                            setHighlightedIndex(index)
                          },
                        })}
                      </Fragment>
                    ))
                  }
                </div>
              </div>
            </div>,
            anchorElementRef.current,
          )
        }
      </>
    )
  }, [allFlattenOptions.length, workflowVariableBlock?.show, floatingStyles, isPositioned, refs, workflowVariableOptions, isSupportFileVar, handleClose, currentBlock?.generatorType, handleSelectWorkflowVariable, queryString, workflowVariableBlock?.showManageInputField, workflowVariableBlock?.onManageInputField])

  return (
    <LexicalTypeaheadMenuPlugin
      options={allFlattenOptions}
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      // The `translate` class is used to workaround the issue that the `typeahead-menu` menu is not positioned as expected.
      // See also https://github.com/facebook/lexical/blob/772520509308e8ba7e4a82b6cd1996a78b3298d0/packages/lexical-react/src/shared/LexicalMenu.ts#L498
      //
      // We no need the position function of the `LexicalTypeaheadMenuPlugin`,
      // so the reference anchor should be positioned based on the range of the trigger string, and the menu will be positioned by the floating ui.
      anchorClassName='z-[999999] translate-y-[calc(-100%-3px)]'
      menuRenderFn={renderMenu}
      triggerFn={checkForTriggerMatch}
    />
  )
}

export default memo(ComponentPicker)
