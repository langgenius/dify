import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import { $insertNodes, type TextNode } from 'lexical'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useBasicTypeaheadTriggerMatch } from '../hooks'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from './variable-block'
import { $createCustomTextNode } from './custom-text/node'
import { BracketsX } from '@/app/components/base/icons/src/vender/line/development'
import { Tool03 } from '@/app/components/base/icons/src/vender/solid/general'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import AppIcon from '@/app/components/base/app-icon'
import { useEventEmitterContextContext } from '@/context/event-emitter'

class VariablePickerOption extends MenuOption {
  title: string
  icon?: JSX.Element
  extraElement?: JSX.Element
  keywords: Array<string>
  keyboardShortcut?: string
  onSelect: (queryString: string) => void

  constructor(
    title: string,
    options: {
      icon?: JSX.Element
      extraElement?: JSX.Element
      keywords?: Array<string>
      keyboardShortcut?: string
      onSelect: (queryString: string) => void
    },
  ) {
    super(title)
    this.title = title
    this.keywords = options.keywords || []
    this.icon = options.icon
    this.extraElement = options.extraElement
    this.keyboardShortcut = options.keyboardShortcut
    this.onSelect = options.onSelect.bind(this)
  }
}

type VariablePickerMenuItemProps = {
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
  option: VariablePickerOption
  queryString: string | null
}
const VariablePickerMenuItem: FC<VariablePickerMenuItemProps> = ({
  isSelected,
  onClick,
  onMouseEnter,
  option,
  queryString,
}) => {
  const title = option.title
  let before = title
  let middle = ''
  let after = ''

  if (queryString) {
    const regex = new RegExp(queryString, 'i')
    const match = regex.exec(option.title)

    if (match) {
      before = title.substring(0, match.index)
      middle = match[0]
      after = title.substring(match.index + match[0].length)
    }
  }

  return (
    <div
      key={option.key}
      className={`
        flex items-center px-3 h-6 rounded-md hover:bg-primary-50 cursor-pointer
        ${isSelected && 'bg-primary-50'}
      `}
      tabIndex={-1}
      ref={option.setRefElement}
      onMouseEnter={onMouseEnter}
      onClick={onClick}>
      <div className='mr-2'>
        {option.icon}
      </div>
      <div className='grow text-[13px] text-gray-900 truncate' title={option.title}>
        {before}
        <span className='text-[#2970FF]'>{middle}</span>
        {after}
      </div>
      {option.extraElement}
    </div>
  )
}

export type Option = {
  value: string
  name: string
}

export type ExternalToolOption = {
  name: string
  variableName: string
  icon?: string
  icon_background?: string
}

type VariablePickerProps = {
  items?: Option[]
  externalTools?: ExternalToolOption[]
  onAddExternalTool?: () => void
}
const VariablePicker: FC<VariablePickerProps> = ({
  items = [],
  externalTools = [],
  onAddExternalTool,
}) => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()
  const [editor] = useLexicalComposerContext()
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('{', {
    minLength: 0,
    maxLength: 6,
  })
  const [queryString, setQueryString] = useState<string | null>(null)

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === INSERT_VARIABLE_VALUE_BLOCK_COMMAND)
      editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, `{{${v.payload}}}`)
  })

  const options = useMemo(() => {
    const baseOptions = items.map((item) => {
      return new VariablePickerOption(item.value, {
        icon: <BracketsX className='w-[14px] h-[14px] text-[#2970FF]' />,
        onSelect: () => {
          editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, `{{${item.value}}}`)
        },
      })
    })
    if (!queryString)
      return baseOptions

    const regex = new RegExp(queryString, 'i')

    return baseOptions.filter(option => regex.test(option.title) || option.keywords.some(keyword => regex.test(keyword)))
  }, [editor, queryString, items])

  const toolOptions = useMemo(() => {
    const baseToolOptions = externalTools.map((item) => {
      return new VariablePickerOption(item.name, {
        icon: (
          <AppIcon
            className='!w-[14px] !h-[14px]'
            icon={item.icon}
            background={item.icon_background}
          />
        ),
        extraElement: <div className='text-xs text-gray-400'>{item.variableName}</div>,
        onSelect: () => {
          editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, `{{${item.variableName}}}`)
        },
      })
    })
    if (!queryString)
      return baseToolOptions

    const regex = new RegExp(queryString, 'i')

    return baseToolOptions.filter(option => regex.test(option.title) || option.keywords.some(keyword => regex.test(keyword)))
  }, [editor, queryString, externalTools])

  const newOption = new VariablePickerOption(t('common.promptEditor.variable.modal.add'), {
    icon: <BracketsX className='mr-2 w-[14px] h-[14px] text-[#2970FF]' />,
    onSelect: () => {
      editor.update(() => {
        const prefixNode = $createCustomTextNode('{{')
        const suffixNode = $createCustomTextNode('}}')
        $insertNodes([prefixNode, suffixNode])
        prefixNode.select()
      })
    },
  })

  const newToolOption = new VariablePickerOption(t('common.promptEditor.variable.modal.addTool'), {
    icon: <Tool03 className='mr-2 w-[14px] h-[14px] text-[#444CE7]' />,
    extraElement: <ArrowUpRight className='w-3 h-3 text-gray-400' />,
    onSelect: () => {
      if (onAddExternalTool)
        onAddExternalTool()
    },
  })

  const onSelectOption = useCallback(
    (
      selectedOption: VariablePickerOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
      matchingString: string,
    ) => {
      editor.update(() => {
        if (nodeToRemove)
          nodeToRemove.remove()

        selectedOption.onSelect(matchingString)
        closeMenu()
      })
    },
    [editor],
  )

  const mergedOptions = [...options, ...toolOptions, newOption, newToolOption]

  return (
    <LexicalTypeaheadMenuPlugin
      options={mergedOptions}
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      anchorClassName='z-[999999]'
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) =>
        (anchorElementRef.current && mergedOptions.length)
          ? ReactDOM.createPortal(
            <div className='mt-[25px] w-[240px] bg-white rounded-lg border-[0.5px] border-gray-200 shadow-lg'>
              {
                !!options.length && (
                  <>
                    <div className='p-1'>
                      {options.map((option, i: number) => (
                        <VariablePickerMenuItem
                          isSelected={selectedIndex === i}
                          onClick={() => {
                            setHighlightedIndex(i)
                            selectOptionAndCleanUp(option)
                          }}
                          onMouseEnter={() => {
                            setHighlightedIndex(i)
                          }}
                          key={option.key}
                          option={option}
                          queryString={queryString}
                        />
                      ))}
                    </div>
                    <div className='h-[1px] bg-gray-100' />
                  </>
                )
              }
              {
                !!toolOptions.length && (
                  <>
                    <div className='p-1'>
                      {toolOptions.map((option, i: number) => (
                        <VariablePickerMenuItem
                          isSelected={selectedIndex === i + options.length}
                          onClick={() => {
                            setHighlightedIndex(i + options.length)
                            selectOptionAndCleanUp(option)
                          }}
                          onMouseEnter={() => {
                            setHighlightedIndex(i + options.length)
                          }}
                          key={option.key}
                          option={option}
                          queryString={queryString}
                        />
                      ))}
                    </div>
                    <div className='h-[1px] bg-gray-100' />
                  </>
                )
              }
              <div className='p-1'>
                <div
                  className={`
                    flex items-center px-3 h-6 rounded-md hover:bg-primary-50 cursor-pointer
                    ${selectedIndex === options.length + toolOptions.length && 'bg-primary-50'}
                  `}
                  ref={newOption.setRefElement}
                  tabIndex={-1}
                  onClick={() => {
                    setHighlightedIndex(options.length + toolOptions.length)
                    selectOptionAndCleanUp(newOption)
                  }}
                  onMouseEnter={() => {
                    setHighlightedIndex(options.length + toolOptions.length)
                  }}
                  key={newOption.key}
                >
                  {newOption.icon}
                  <div className='text-[13px] text-gray-900'>{newOption.title}</div>
                </div>
                <div
                  className={`
                    flex items-center px-3 h-6 rounded-md hover:bg-primary-50 cursor-pointer
                    ${selectedIndex === options.length + toolOptions.length + 1 && 'bg-primary-50'}
                  `}
                  ref={newToolOption.setRefElement}
                  tabIndex={-1}
                  onClick={() => {
                    setHighlightedIndex(options.length + toolOptions.length + 1)
                    selectOptionAndCleanUp(newToolOption)
                  }}
                  onMouseEnter={() => {
                    setHighlightedIndex(options.length + toolOptions.length + 1)
                  }}
                  key={newToolOption.key}
                >
                  {newToolOption.icon}
                  <div className='grow text-[13px] text-gray-900'>{newToolOption.title}</div>
                  {newToolOption.extraElement}
                </div>
              </div>
            </div>,
            anchorElementRef.current,
          )
          : null}
      triggerFn={checkForTriggerMatch}
    />
  )
}

export default VariablePicker
