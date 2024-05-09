import {
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
import { useOptions } from './hooks'
import type { PickerBlockMenuOption } from './menu'
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
  const { refs, floatingStyles, isPositioned } = useFloating({
    placement: 'bottom-start',
    middleware: [
      offset(16), // fix hide cursor
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
    allOptions,
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

    if (variables[1] === 'sys.query' || variables[1] === 'sys.files')
      editor.dispatchCommand(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, [variables[1]])
    else
      editor.dispatchCommand(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, variables)
  }, [editor, checkForTriggerMatch, triggerString])

  const renderMenu = useCallback<MenuRenderFn<PickerBlockMenuOption>>((
    anchorElementRef,
    { options, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
  ) => {
    if (!(anchorElementRef.current && (allOptions.length || workflowVariableBlock?.show)))
      return null
    refs.setReference(anchorElementRef.current)

    return (
      <>
        {
          ReactDOM.createPortal(
            // The `LexicalMenu` will try to calculate the position of the floating menu based on the first child.
            // Since we use floating ui, we need to wrap it with a div to prevent the position calculation being affected.
            // See https://github.com/facebook/lexical/blob/ac97dfa9e14a73ea2d6934ff566282d7f758e8bb/packages/lexical-react/src/shared/LexicalMenu.ts#L493
            <div className='w-full h-full'>
              <div
                className='p-1 w-[260px] bg-white rounded-lg border-[0.5px] border-gray-200 shadow-lg overflow-y-auto'
                style={{
                  ...floatingStyles,
                  visibility: isPositioned ? 'visible' : 'hidden',
                  maxHeight: 'calc(1 / 3 * 100vh)',
                }}
                ref={refs.setFloating}
              >
                {
                  options.map((option, index) => (
                    <>
                      {
                        // Divider
                        index !== 0 && options.at(index - 1)?.group !== option.group && (
                          <div className='my-1 h-[1px] bg-gray-100'></div>
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
                    </>
                  ))
                }
                {
                  workflowVariableBlock?.show && (
                    <>
                      {
                        (!!options.length) && (
                          <div className='my-1 h-[1px] bg-gray-100'></div>
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
            </div>,
            anchorElementRef.current,
          )
        }
      </>
    )
  }, [allOptions.length, workflowVariableBlock?.show, refs, isPositioned, floatingStyles, queryString, workflowVariableOptions, handleSelectWorkflowVariable])

  return (
    <LexicalTypeaheadMenuPlugin
      options={allOptions}
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      anchorClassName='z-[999999]'
      menuRenderFn={renderMenu}
      triggerFn={checkForTriggerMatch}
    />
  )
}

export default memo(ComponentPicker)
