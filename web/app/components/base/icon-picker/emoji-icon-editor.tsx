import type { Ref } from 'react'
import type { EmojiIcon } from '.'
import type { EmojiPickerHandle } from './emoji-picker'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { EmojiPicker } from './emoji-picker'
import { defaultEmojiBackground, emojiStyles } from './emoji-styles'

export function EmojiIconEditor({
  ref,
  value,
  onValueChange,
}: {
  ref?: Ref<EmojiPickerHandle>
  value?: EmojiIcon
  onValueChange: (value: EmojiIcon) => void
}) {
  const { t } = useTranslation(['app'])
  const labelId = useId()
  return (
    <>
      <EmojiPicker
        ref={ref}
        value={value?.icon}
        onValueChange={(icon) =>
          onValueChange({
            type: 'emoji',
            icon,
            background: value?.background ?? defaultEmojiBackground,
          })
        }
      />
      {value && (
        <section className="shrink-0 border-t border-divider-subtle bg-components-panel-bg-blur px-3 pt-2 pb-3 backdrop-blur-sm">
          <h3 id={labelId} className="px-0.5 py-1 system-xs-semibold-uppercase text-text-primary">
            {t(($) => $['iconPicker.chooseStyle'], { ns: 'app' })}
          </h3>
          <RadioGroup
            aria-labelledby={labelId}
            value={value.background.toUpperCase()}
            onValueChange={(background) => onValueChange({ ...value, background })}
            className="grid grid-cols-6 justify-items-center gap-0.75 pt-0.5"
          >
            {emojiStyles.map((style) => (
              <RadioItem
                key={style.background}
                value={style.background}
                aria-label={t(($) => $[style.label], { ns: 'app' })}
                className={cn(
                  'flex aspect-square w-full max-w-11.5 items-center justify-center rounded-xl p-0.75 outline-none ring-inset hover:bg-state-base-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-state-accent-solid focus-visible:outline-solid data-checked:ring-[1.5px]',
                  style.selectedClassName,
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex aspect-square w-full items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular text-2xl leading-none',
                    style.backgroundClassName,
                  )}
                >
                  {value.icon}
                </span>
              </RadioItem>
            ))}
          </RadioGroup>
        </section>
      )}
    </>
  )
}
