import { memo } from 'react'
import Divider from './divider'
import type { ColorPickerProps } from './color-picker'
import ColorPicker from './color-picker'
import FontSizeSelector from './font-size-selector'
import Command from './command'
import type { OperatorProps } from './operator'
import Operator from './operator'

type ToolbarProps = ColorPickerProps & OperatorProps
const Toolbar = ({
  theme,
  onThemeChange,
  onCopy,
  onDuplicate,
  onDelete,
  showAuthor,
  onShowAuthorChange,
}: ToolbarProps) => {
  return (
    <div className='inline-flex items-center p-0.5 bg-components-actionbar-bg rounded-lg border-[0.5px] border-components-actionbar-border shadow-sm'>
      <ColorPicker
        theme={theme}
        onThemeChange={onThemeChange}
      />
      <Divider />
      <FontSizeSelector />
      <Divider />
      <div className='flex items-center space-x-0.5'>
        <Command type='bold' />
        <Command type='italic' />
        <Command type='strikethrough' />
        <Command type='link' />
        <Command type='bullet' />
      </div>
      <Divider />
      <Operator
        onCopy={onCopy}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        showAuthor={showAuthor}
        onShowAuthorChange={onShowAuthorChange}
      />
    </div>
  )
}

export default memo(Toolbar)
