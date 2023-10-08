import type { FC } from 'react'
import { useCallback } from 'react'
import ReactDOM from 'react-dom'
import type { TextNode } from 'lexical'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from './variable-block'
import { BracketsX } from '@/app/components/base/icons/src/vender/line/development'

class VariablePickerOption extends MenuOption {
  title: string
  icon?: JSX.Element
  keywords: Array<string>
  keyboardShortcut?: string
  onSelect: (queryString: string) => void

  constructor(
    title: string,
    options: {
      icon?: JSX.Element
      keywords?: Array<string>
      keyboardShortcut?: string
      onSelect: (queryString: string) => void
    },
  ) {
    super(title)
    this.title = title
    this.keywords = options.keywords || []
    this.icon = options.icon
    this.keyboardShortcut = options.keyboardShortcut
    this.onSelect = options.onSelect.bind(this)
  }
}

type VariablePickerMenuItemProps = {
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
  option: VariablePickerOption
}
const VariablePickerMenuItem: FC<VariablePickerMenuItemProps> = ({
  isSelected,
  onClick,
  onMouseEnter,
  option,
}) => {
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
      <div className='text-[13px] text-gray-900'>{option.title}</div>
    </div>
  )
}

export type Option = {
  value: string
  name: string
}

type VariablePickerProps = {
  items?: Option[]
}
const VariablePicker: FC<VariablePickerProps> = ({
  items = [],
}) => {
  const [editor] = useLexicalComposerContext()
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('{', {
    minLength: 0,
  })

  const options = items.map((item) => {
    return new VariablePickerOption(item.value, {
      icon: <BracketsX className='w-[14px] h-[14px] text-[#2970FF]' />,
      onSelect: () => {
        editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, `{{${item.value}}}`)
      },
    })
  })

  const newOption = new VariablePickerOption('New variable', {
    icon: <BracketsX className='mr-2 w-[14px] h-[14px] text-[#2970FF]' />,
    onSelect: () => {
      editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, '{{')
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

  const mergedOptions = [...options, newOption]

  return (
    <LexicalTypeaheadMenuPlugin
      options={mergedOptions}
      onQueryChange={() => {}}
      onSelectOption={onSelectOption}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) =>
        (anchorElementRef.current && mergedOptions.length)
          ? ReactDOM.createPortal(
            <div className='mt-[25px] w-[240px] bg-white rounded-lg border-[0.5px] border-gray-200 shadow-lg'>
              {
                !!items.length && (
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
                    ${selectedIndex === options.length && 'bg-primary-50'}
                  `}
                  ref={newOption.setRefElement}
                  tabIndex={-1}
                  onClick={() => {
                    setHighlightedIndex(options.length)
                    selectOptionAndCleanUp(newOption)
                  }}
                  onMouseEnter={() => {
                    setHighlightedIndex(options.length)
                  }}
                  key={newOption.key}
                >
                  {newOption.icon}
                  <div className='text-[13px] text-gray-900'>{newOption.title}</div>
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
