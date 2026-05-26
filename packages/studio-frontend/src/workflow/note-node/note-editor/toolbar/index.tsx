import type { ColorPickerProps } from '@/app/components/workflow/note-node/note-editor/toolbar/color-picker'
import type { OperatorProps } from '@/app/components/workflow/note-node/note-editor/toolbar/operator'
import { memo } from 'react'
import ColorPicker from '@/app/components/workflow/note-node/note-editor/toolbar/color-picker'
import Command from '@/app/components/workflow/note-node/note-editor/toolbar/command'
import Divider from '@/app/components/workflow/note-node/note-editor/toolbar/divider'
import FontSizeSelector from '@/app/components/workflow/note-node/note-editor/toolbar/font-size-selector'
import Operator from '@/app/components/workflow/note-node/note-editor/toolbar/operator'

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
    <div
      className="nodrag nopan nowheel inline-flex items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-sm"
      onMouseDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <ColorPicker
        theme={theme}
        onThemeChange={onThemeChange}
      />
      <Divider />
      <FontSizeSelector />
      <Divider />
      <div className="flex items-center space-x-0.5">
        <Command type="bold" />
        <Command type="italic" />
        <Command type="strikethrough" />
        <Command type="link" />
        <Command type="bullet" />
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
