import type { FC } from 'react'
import ReactDOM from 'react-dom'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
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
  onClick: () => void
  onMouseEnter: () => void
  option: VariablePickerOption
}
const VariablePickerMenuItem: FC<VariablePickerMenuItemProps> = ({
  onClick,
  onMouseEnter,
  option,
}) => {
  return (
    <div
      key={option.key}
      className='flex items-center px-3 h-6 rounded-md hover:bg-primary-50 cursor-pointer'
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

const VariablePicker = () => {
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('{', {
    minLength: 0,
    maxLength: 2,
  })

  const options = [
    new VariablePickerOption('user', {
      icon: <BracketsX className='w-[14px] h-[14px] text-[#2970FF]' />,
      onSelect: () => {},
    }),
    new VariablePickerOption('name', {
      icon: <BracketsX className='w-[14px] h-[14px] text-[#2970FF]' />,
      onSelect: () => {},
    }),
    new VariablePickerOption('gameTypeA', {
      icon: <BracketsX className='w-[14px] h-[14px] text-[#2970FF]' />,
      onSelect: () => {},
    }),
    new VariablePickerOption('gameTypeB', {
      icon: <BracketsX className='w-[14px] h-[14px] text-[#2970FF]' />,
      onSelect: () => {},
    }),
    new VariablePickerOption('lang', {
      icon: <BracketsX className='w-[14px] h-[14px] text-[#2970FF]' />,
      onSelect: () => {},
    }),
  ]

  return (
    <LexicalTypeaheadMenuPlugin
      options={options}
      onQueryChange={() => {}}
      onSelectOption={() => {}}
      menuRenderFn={(
        anchorElementRef,
        { selectOptionAndCleanUp, setHighlightedIndex },
      ) =>
        (anchorElementRef.current && options.length)
          ? ReactDOM.createPortal(
            <div className='mt-[25px] w-[240px] bg-white rounded-lg border-[0.5px] border-gray-200 shadow-lg'>
              <div className='p-1'>
                {options.map((option, i: number) => (
                  <VariablePickerMenuItem
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
              <div className='p-1'>
                <div className='flex items-center px-3 h-6 rounded-md hover:bg-primary-50 cursor-pointer'>
                  <BracketsX className='mr-2 w-[14px] h-[14px] text-[#2970FF]' />
                  <div className='text-[13px] text-gray-900'>New variable</div>
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
