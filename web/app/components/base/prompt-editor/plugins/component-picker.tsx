import type { FC } from 'react'
import { useCallback } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TextNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { useBasicTypeaheadTriggerMatch } from '../hooks'
import { INSERT_CONTEXT_BLOCK_COMMAND } from './context-block'
import { INSERT_VARIABLE_BLOCK_COMMAND } from './variable-block'
import { INSERT_HISTORY_BLOCK_COMMAND } from './history-block'
import { INSERT_QUERY_BLOCK_COMMAND } from './query-block'
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
  disabled?: boolean

  constructor(
    title: string,
    options: {
      icon?: JSX.Element
      keywords?: Array<string>
      keyboardShortcut?: string
      desc: string
      onSelect: (queryString: string) => void
      disabled?: boolean
    },
  ) {
    super(title)
    this.title = title
    this.keywords = options.keywords || []
    this.icon = options.icon
    this.keyboardShortcut = options.keyboardShortcut
    this.desc = options.desc
    this.onSelect = options.onSelect.bind(this)
    this.disabled = options.disabled
  }
}

type ComponentPickerMenuItemProps = {
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
  option: ComponentPickerOption
}
const ComponentPickerMenuItem: FC<ComponentPickerMenuItemProps> = ({
  isSelected,
  onClick,
  onMouseEnter,
  option,
}) => {
  const { t } = useTranslation()

  return (
    <div
      key={option.key}
      className={`
        flex items-center px-3 py-1.5 rounded-lg 
        ${isSelected && !option.disabled && '!bg-gray-50'}
        ${option.disabled ? 'cursor-not-allowed opacity-30' : 'hover:bg-gray-50 cursor-pointer'}
      `}
      tabIndex={-1}
      ref={option.setRefElement}
      onMouseEnter={onMouseEnter}
      onClick={onClick}>
      <div className='flex items-center justify-center mr-2 w-8 h-8 rounded-lg border border-gray-100'>
        {option.icon}
      </div>
      <div className='grow'>
        <div className='flex items-center justify-between h-5 text-sm text-gray-900'>
          {option.title}
          <span className='text-xs text-gray-400'>{option.disabled && t('common.promptEditor.existed')}</span>
        </div>
        <div className='text-xs text-gray-500'>{option.desc}</div>
      </div>
    </div>
  )
}

type ComponentPickerProps = {
  contextDisabled?: boolean
  historyDisabled?: boolean
  queryDisabled?: boolean
  contextShow?: boolean
  historyShow?: boolean
  queryShow?: boolean
}
const ComponentPicker: FC<ComponentPickerProps> = ({
  contextDisabled,
  historyDisabled,
  queryDisabled,
  contextShow,
  historyShow,
  queryShow,
}) => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
    maxLength: 0,
  })

  const options = [
    ...contextShow
      ? [
        new ComponentPickerOption(t('common.promptEditor.context.item.title'), {
          desc: t('common.promptEditor.context.item.desc'),
          icon: <File05 className='w-4 h-4 text-[#6938EF]' />,
          onSelect: () => {
            if (contextDisabled)
              return
            editor.dispatchCommand(INSERT_CONTEXT_BLOCK_COMMAND, undefined)
          },
          disabled: contextDisabled,
        }),
      ]
      : [],
    new ComponentPickerOption(t('common.promptEditor.variable.item.title'), {
      desc: t('common.promptEditor.variable.item.desc'),
      icon: <Variable className='w-4 h-4 text-[#2970FF]' />,
      onSelect: () => {
        editor.dispatchCommand(INSERT_VARIABLE_BLOCK_COMMAND, undefined)
      },
    }),
    ...historyShow
      ? [
        new ComponentPickerOption(t('common.promptEditor.history.item.title'), {
          desc: t('common.promptEditor.history.item.desc'),
          icon: <MessageClockCircle className='w-4 h-4 text-[#DD2590]' />,
          onSelect: () => {
            if (historyDisabled)
              return
            editor.dispatchCommand(INSERT_HISTORY_BLOCK_COMMAND, undefined)
          },
          disabled: historyDisabled,
        }),
      ]
      : [],
    ...queryShow
      ? [
        new ComponentPickerOption(t('common.promptEditor.query.item.title'), {
          desc: t('common.promptEditor.query.item.desc'),
          icon: <UserEdit02 className='w-4 h-4 text-[#FD853A]' />,
          onSelect: () => {
            if (queryDisabled)
              return
            editor.dispatchCommand(INSERT_QUERY_BLOCK_COMMAND, undefined)
          },
          disabled: queryDisabled,
        }),
      ]
      : [],
  ]

  const onSelectOption = useCallback(
    (
      selectedOption: ComponentPickerOption,
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

  return (
    <LexicalTypeaheadMenuPlugin
      options={options}
      onQueryChange={() => { }}
      onSelectOption={onSelectOption}
      anchorClassName='z-[999999]'
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) =>
        (anchorElementRef.current && options.length)
          ? ReactDOM.createPortal(
            <div className='mt-[25px] p-1 w-[400px] bg-white rounded-lg border-[0.5px] border-gray-200 shadow-lg'>
              {options.map((option, i: number) => (
                <ComponentPickerMenuItem
                  isSelected={selectedIndex === i}
                  onClick={() => {
                    if (option.disabled)
                      return
                    setHighlightedIndex(i)
                    selectOptionAndCleanUp(option)
                  }}
                  onMouseEnter={() => {
                    if (option.disabled)
                      return
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
