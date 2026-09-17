import type { Locale } from '@/i18n-config'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useLocale } from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n-config'
import { languages } from '@/i18n-config/language'

const supportedLanguages = languages.filter((language) => language.supported)

export default function LocaleMenu() {
  const locale = useLocale()
  const selectedLanguage = supportedLanguages.find((language) => language.value === locale)
  const selectedLanguageName =
    selectedLanguage?.value === 'en-US' ? selectedLanguage.prompt_name : selectedLanguage?.name

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1 rounded-lg p-2 system-sm-medium text-text-tertiary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          />
        }
      >
        <span aria-hidden className="i-ri-global-line size-4 shrink-0" />
        <span>{selectedLanguageName}</span>
        <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-end" className="max-h-80 w-60 overflow-y-auto">
        <DropdownMenuRadioGroup<Locale>
          value={locale}
          onValueChange={(value) => {
            void setLocaleOnClient(value, false)
          }}
        >
          {supportedLanguages.map((language) => (
            <DropdownMenuRadioItem<Locale> key={language.value} value={language.value} closeOnClick>
              <span className="grow">{language.name}</span>
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
