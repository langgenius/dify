import { memo } from 'react'
import Divider from './divider'
import type { ColorPickerProps } from './color-picker'
import ColorPicker from './color-picker'
import FontSizeSelector from './font-size-selector'
import Command from './command'
import Operator from './operator'

type ToolbarProps = ColorPickerProps
const Toolbar = ({
  onColorChange,
}: ToolbarProps) => {
  return (
    <div className='inline-flex items-center p-0.5 bg-white rounded-lg border-[0.5px] border-black/5 shadow-sm'>
      <ColorPicker onColorChange={onColorChange} />
      <Divider />
      <FontSizeSelector />
      <Divider />
      <div className='flex items-center space-x-0.5'>
        <Command type='bold' />
        <Command type='strikethrough' />
        <Command type='link' />
        <Command type='bullet' />
      </div>
      <Divider />
      <Operator />
    </div>
  )
}

export default memo(Toolbar)
