import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'

type ModelSelectorSearchHeaderProps = {
  inputValue: string
  onInputValueChange: (value: string) => void
}

export function ModelSelectorSearchHeader({
  inputValue,
  onInputValueChange,
}: ModelSelectorSearchHeaderProps) {
  const { t } = useTranslation()

  return (
    <SearchInput
      aria-label={t(($) => $['form.searchModel'], { ns: 'datasetSettings' }) || ''}
      className="mx-2 mt-2 mb-1 shrink-0"
      placeholder={t(($) => $['form.searchModel'], { ns: 'datasetSettings' }) || ''}
      value={inputValue}
      onValueChange={onInputValueChange}
    />
  )
}

type ModelSelectorScrollBodyProps = {
  children: ReactNode
  label: string
}

export function ModelSelectorScrollBody({ children, label }: ModelSelectorScrollBodyProps) {
  return (
    <ScrollArea className="relative min-h-0 overflow-hidden">
      <ScrollAreaViewport
        aria-label={label}
        style={{ overflowX: 'hidden' }}
        className="max-h-[calc(min(624px,var(--available-height,624px))-84px)] overscroll-contain"
        role="region"
      >
        <ScrollAreaContent style={{ minWidth: 0 }}>{children}</ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar className="z-2">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  )
}

export function CompatibleModelsNotice() {
  const { t } = useTranslation()

  return (
    <div className="px-4 py-2 system-xs-regular text-text-tertiary">
      {t(($) => $['modelProvider.selector.onlyCompatibleModelsShown'], { ns: 'common' })}
    </div>
  )
}

type ShowIncompatibleModelsButtonProps = {
  showIncompatibleModels: boolean
  onClick: () => void
}

export function ShowIncompatibleModelsButton({
  showIncompatibleModels,
  onClick,
}: ShowIncompatibleModelsButtonProps) {
  const { t } = useTranslation()

  return (
    <Button
      variant="ghost"
      size="medium"
      className="h-10 w-full justify-start rounded-none px-4 text-left system-xs-regular text-text-tertiary"
      onClick={onClick}
    >
      <span className="min-w-0 truncate">
        {showIncompatibleModels
          ? t(($) => $['modelProvider.selector.hideIncompatibleModels'], { ns: 'common' })
          : t(($) => $['modelProvider.selector.showIncompatibleModels'], { ns: 'common' })}
      </span>
    </Button>
  )
}

type ModelProviderSettingsFooterProps = {
  onOpenSettings: () => void
}

export function ModelProviderSettingsFooter({ onOpenSettings }: ModelProviderSettingsFooterProps) {
  const { t } = useTranslation()

  return (
    <div className="shrink-0 border-t border-divider-subtle p-1">
      <Button
        variant="ghost"
        size="medium"
        className="w-full justify-start gap-2 px-3 py-1 text-text-tertiary"
        onClick={onOpenSettings}
      >
        <span aria-hidden className="i-ri-equalizer-2-line size-4 shrink-0" />
        <span className="system-xs-medium">
          {t(($) => $['modelProvider.selector.modelProviderSettings'], { ns: 'common' })}
        </span>
      </Button>
    </div>
  )
}
