import type { EmojiIcon, IconPickerValue } from '..'
import { expectTypeOf } from 'vitest'
import { IconPicker } from '..'

export function iconPickerTypeContract() {
  const icon = { type: 'emoji', icon: '😀', background: '#F5F3FF' } as const
  const controlled = <IconPicker value={null}>{null}</IconPicker>
  const preview = (
    <IconPicker defaultValue={{ type: 'link', url: '/avatar.svg' }}>{null}</IconPicker>
  )
  const confirmed = (
    <IconPicker
      defaultValue={icon}
      onValueChange={(value) => {
        expectTypeOf(value).toEqualTypeOf<IconPickerValue>()
      }}
    >
      {null}
    </IconPicker>
  )
  const narrowedCallback = (
    // @ts-expect-error An initial emoji does not prevent confirming an image.
    <IconPicker value={icon} onValueChange={(value: EmojiIcon) => value}>
      {null}
    </IconPicker>
  )
  return [controlled, preview, confirmed, narrowedCallback]
}
