import type { IconPickerInputValue } from '..'
import { useState } from 'react'
import { defaultIcon } from '@/test/icon-picker'
import { IconPicker, IconPickerContent, IconPickerIcon, IconPickerTrigger } from '..'

export function IconPickerCaller({
  initialValue = defaultIcon,
  enableImageUpload,
}: {
  initialValue?: IconPickerInputValue
  enableImageUpload?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <>
      <IconPicker value={value} onValueChange={setValue}>
        <IconPickerTrigger aria-label="Choose icon">
          <IconPickerIcon />
        </IconPickerTrigger>
        <IconPickerContent enableImageUpload={enableImageUpload} />
      </IconPicker>
      <output aria-label="Saved icon">{JSON.stringify(value)}</output>
      {value.type !== 'emoji' && <img alt="Saved icon preview" src={value.url} />}
    </>
  )
}
