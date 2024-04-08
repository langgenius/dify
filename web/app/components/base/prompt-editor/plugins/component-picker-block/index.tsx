import {
  memo,
  useCallback,
  useState,
} from 'react'
import ReactDOM from 'react-dom'
import {
  FloatingPortal,
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
  ExternalToolBlockType,
  HistoryBlockType,
  QueryBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from '../../types'
import { useBasicTypeaheadTriggerMatch } from '../../hooks'
import { INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND } from '../workflow-variable-block'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '../variable-block'
import { $splitNodeContainingQuery } from '../../utils'
import type { PromptOption } from './prompt-option'
import PromptMenu from './prompt-menu'
import VariableMenu from './variable-menu'
import type { VariableOption } from './variable-option'
import { useOptions } from './hooks'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import { useEventEmitterContextContext } from '@/context/event-emitter'

type ComponentPickerProps = {
  triggerString: string
  contextBlock?: ContextBlockType
  queryBlock?: QueryBlockType
  historyBlock?: HistoryBlockType
  variableBlock?: VariableBlockType
  externalToolBlock?: ExternalToolBlockType
  workflowVariableBlock?: WorkflowVariableBlockType
}
const ComponentPicker = ({
  triggerString,
  contextBlock,
  queryBlock,
  historyBlock,
  variableBlock,
  externalToolBlock,
  workflowVariableBlock,
}: ComponentPickerProps) => {
  const { eventEmitter } = useEventEmitterContextContext()
  const { refs, floatingStyles, elements } = useFloating({
    placement: 'bottom-start',
    middleware: [
      offset(16), // fix hide cursor
      shift(),
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
    allOptions,
    promptOptions,
    variableOptions,
    externalToolOptions,
    workflowVariableOptions,
  } = useOptions(
    contextBlock,
    queryBlock,
    historyBlock,
    variableBlock,
    externalToolBlock,
    workflowVariableBlock,
  )

  const onSelectOption = useCallback(
    (
      selectedOption: PromptOption | VariableOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
      matchingString: string,
    ) => {
      editor.update(() => {
        if (nodeToRemove && selectedOption?.key)
          nodeToRemove.remove()

        if (selectedOption?.onSelect)
          selectedOption.onSelect(matchingString)

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

    if (variables[1] === 'sys.query' || variables[1] === 'sys.files')
      editor.dispatchCommand(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, [variables[1]])
    else
      editor.dispatchCommand(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, variables)
  }, [editor, checkForTriggerMatch, triggerString])

  const renderMenu = useCallback<MenuRenderFn<PromptOption | VariableOption>>((
    anchorElementRef,
    { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
  ) => {
    if (anchorElementRef.current && (allOptions.length || workflowVariableBlock?.show)) {
      return (
        <>
          {
            ReactDOM.createPortal(
              <div ref={refs.setReference}></div>,
              anchorElementRef.current,
            )
          }
          {
            elements.reference && (
              <FloatingPortal id='typeahead-menu'>
                <div
                  className='w-[260px] bg-white rounded-lg border-[0.5px] border-gray-200 shadow-lg overflow-y-auto'
                  style={{
                    ...floatingStyles,
                    maxHeight: 'calc(1 / 3 * 100vh)',
                  }}
                  ref={refs.setFloating}
                >
                  {
                    !!promptOptions.length && (
                      <>
                        <PromptMenu
                          startIndex={0}
                          selectedIndex={selectedIndex}
                          options={promptOptions}
                          onClick={(index, option) => {
                            if (option.disabled)
                              return
                            setHighlightedIndex(index)
                            selectOptionAndCleanUp(option)
                          }}
                          onMouseEnter={(index, option) => {
                            if (option.disabled)
                              return
                            setHighlightedIndex(index)
                          }}
                        />
                      </>
                    )
                  }
                  {
                    !!variableOptions.length && (
                      <>
                        {
                          !!promptOptions.length && (
                            <div className='h-[1px] bg-gray-100'></div>
                          )
                        }
                        <VariableMenu
                          startIndex={promptOptions.length}
                          selectedIndex={selectedIndex}
                          options={variableOptions}
                          onClick={(index, option) => {
                            if (option.disabled)
                              return
                            setHighlightedIndex(index)
                            selectOptionAndCleanUp(option)
                          }}
                          onMouseEnter={(index, option) => {
                            if (option.disabled)
                              return
                            setHighlightedIndex(index)
                          }}
                          queryString={queryString}
                        />
                      </>
                    )
                  }
                  {
                    !!externalToolOptions.length && (
                      <>
                        {
                          (!!promptOptions.length || !!variableOptions.length) && (
                            <div className='h-[1px] bg-gray-100'></div>
                          )
                        }
                        <VariableMenu
                          startIndex={promptOptions.length + variableOptions.length}
                          selectedIndex={selectedIndex}
                          options={externalToolOptions}
                          onClick={(index, option) => {
                            if (option.disabled)
                              return
                            setHighlightedIndex(index)
                            selectOptionAndCleanUp(option)
                          }}
                          onMouseEnter={(index, option) => {
                            if (option.disabled)
                              return
                            setHighlightedIndex(index)
                          }}
                          queryString={queryString}
                        />
                      </>
                    )
                  }
                  {
                    workflowVariableBlock?.show && (
                      <>
                        {
                          (!!promptOptions.length || !!variableOptions.length || !!externalToolOptions.length) && (
                            <div className='h-[1px] bg-gray-100'></div>
                          )
                        }
                        <div className='p-1'>
                          <VarReferenceVars
                            hideSearch
                            vars={workflowVariableOptions}
                            onChange={(variables: string[]) => {
                              handleSelectWorkflowVariable(variables)
                            }}
                          />
                        </div>
                      </>
                    )
                  }
                </div>
              </FloatingPortal>
            )
          }
        </>
      )
    }

    return null
  }, [
    allOptions,
    promptOptions,
    variableOptions,
    externalToolOptions,
    queryString,
    workflowVariableBlock?.show,
    workflowVariableOptions,
    handleSelectWorkflowVariable,
    elements,
    floatingStyles,
    refs,
  ])

  return (
    <LexicalTypeaheadMenuPlugin
      options={allOptions as any}
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      anchorClassName='z-[999999]'
      menuRenderFn={renderMenu}
      triggerFn={checkForTriggerMatch}
    />
  )
}

export default memo(ComponentPicker)
