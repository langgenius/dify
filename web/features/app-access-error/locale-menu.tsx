import type { Locale } from '@/i18n'
import { useDirection } from '@langgenius/dify-ui/direction-provider'
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { languages } from '@/i18n/language'

const supportedLanguages = languages.filter((language) => language.supported)

export default function LocaleMenu({
  locale,
  onChange,
}: {
  locale: Locale
  onChange: (locale: Locale) => void
}) {
  const direction = useDirection()
  const selectedLanguage = supportedLanguages.find((language) => language.value === locale)
  const selectedLanguageName =
    selectedLanguage?.value === 'en-US' ? selectedLanguage.prompt_name : selectedLanguage?.name

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1 rounded-lg p-2 system-sm-medium text-text-tertiary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          />
        }
      >
        <span aria-hidden className="i-ri-global-line size-4 shrink-0" />
        {/* oxlint-disable-next-line dify/require-title-for-truncated-text -- The language menu exposes the full selected label through pointer, keyboard, and touch. */}
        <span className="truncate">{selectedLanguageName}</span>
        <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
      </MenuTrigger>
      <MenuContent dir={direction} className="max-h-80 w-60 overflow-y-auto">
        <MenuRadioGroup<Locale>
          value={locale}
          onValueChange={(value) => {
            onChange(value)
          }}
        >
          {supportedLanguages.map((language) => (
            <MenuRadioItem<Locale> key={language.value} value={language.value} closeOnClick>
              <span className="grow">{language.name}</span>
              <MenuRadioItemIndicator />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}
