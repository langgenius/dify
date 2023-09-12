import type { FC } from 'react'
import ReactDOM from 'react-dom'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { File05 } from '@/app/components/base/icons/src/vender/solid/files'
import { Variable } from '@/app/components/base/icons/src/vender/line/development'
import { MessageClockCircle } from '@/app/components/base/icons/src/vender/solid/general'
import { UserEdit02 } from '@/app/components/base/icons/src/vender/solid/users'

class ComponentPickerOption extends MenuOption {
  title: string
  icon?: JSX.Element
  keywords: Array<string>
  keyboardShortcut?: string
  desc: string
  onSelect: (queryString: string) => void

  constructor(
    title: string,
    options: {
      icon?: JSX.Element
      keywords?: Array<string>
      keyboardShortcut?: string
      desc: string
      onSelect: (queryString: string) => void
    },
  ) {
    super(title)
    this.title = title
    this.keywords = options.keywords || []
    this.icon = options.icon
    this.keyboardShortcut = options.keyboardShortcut
    this.desc = options.desc
    this.onSelect = options.onSelect.bind(this)
  }
}

type ComponentPickerMenuItemProps = {
  onClick: () => void
  onMouseEnter: () => void
  option: ComponentPickerOption
}
const ComponentPickerMenuItem: FC<ComponentPickerMenuItemProps> = ({
  onClick,
  onMouseEnter,
  option,
}) => {
  return (
    <div
      key={option.key}
      className='flex items-center px-3 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer'
      tabIndex={-1}
      ref={option.setRefElement}
      onMouseEnter={onMouseEnter}
      onClick={onClick}>
      <div className='flex items-center justify-center mr-2 w-8 h-8 rounded-lg border border-gray-100'>
        {option.icon}
      </div>
      <div>
        <div className='text-sm text-gray-900'>{option.title}</div>
        <div className='text-xs text-gray-500'>{option.desc}</div>
      </div>
    </div>
  )
}

const ComponentPicker = () => {
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
  })

  const options = [
    new ComponentPickerOption('Context', {
      desc: 'Description text here',
      icon: <File05 className='w-4 h-4 text-[#6938EF]' />,
      onSelect: () => {},
    }),
    new ComponentPickerOption('Variables', {
      desc: 'Description text here',
      icon: <Variable className='w-4 h-4 text-[#2970FF]' />,
      onSelect: () => {},
    }),
    new ComponentPickerOption('Conversation History', {
      desc: 'Insert historical message template',
      icon: <MessageClockCircle className='w-4 h-4 text-[#DD2590]' />,
      onSelect: () => {},
    }),
    new ComponentPickerOption('Query', {
      desc: 'Insert user query template',
      icon: <UserEdit02 className='w-4 h-4 text-[#FD853A]' />,
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
            <div className='mt-[25px] p-1 w-[400px] bg-white rounded-lg border-[0.5px] border-gray-200 shadow-lg'>
              {options.map((option, i: number) => (
                <ComponentPickerMenuItem
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
            </div>,
            anchorElementRef.current,
          )
          : null}
      triggerFn={checkForTriggerMatch}
    />
  )
}

export default ComponentPicker
