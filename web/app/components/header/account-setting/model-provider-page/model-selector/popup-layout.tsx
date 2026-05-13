import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { ComboboxInput, ComboboxInputGroup } from '@langgenius/dify-ui/combobox'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'

type ModelSelectorPopupFrameProps = {
  children: ReactNode
}

export function ModelSelectorPopupFrame({
  children,
}: ModelSelectorPopupFrameProps) {
  return (
    <div className="flex max-h-[min(624px,var(--available-height,624px))] flex-col overflow-hidden rounded-xl bg-components-panel-bg">
      {children}
    </div>
  )
}

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
    <div className="shrink-0 bg-components-panel-bg px-2 pt-2 pb-1">
      <ComboboxInputGroup
        className={cn(
          'h-8 min-h-8 px-2',
          inputValue
            ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs'
            : 'border-transparent bg-components-input-bg-normal',
        )}
      >
        <span
          className={`
            mr-0.5 i-ri-search-line h-4 w-4 shrink-0
            ${inputValue ? 'text-text-tertiary' : 'text-text-quaternary'}
          `}
          aria-hidden="true"
        />
        <ComboboxInput
          aria-label={t('form.searchModel', { ns: 'datasetSettings' }) || ''}
          className="block h-4.5 grow px-1 py-0 text-[13px] text-text-primary"
          placeholder={t('form.searchModel', { ns: 'datasetSettings' }) || ''}
        />
        {
          inputValue && (
            <button
              type="button"
              aria-label={t('operation.clear', { ns: 'common' }) || 'Clear'}
              className="ml-1.5 flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-none text-text-quaternary outline-hidden hover:bg-transparent hover:text-text-quaternary focus-visible:bg-transparent focus-visible:ring-1 focus-visible:ring-components-input-border-active"
              onClick={() => onInputValueChange('')}
              onPointerDown={event => event.preventDefault()}
            >
              <span className="i-custom-vender-solid-general-x-circle h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )
        }
      </ComboboxInputGroup>
    </div>
  )
}

type ModelSelectorScrollBodyProps = {
  children: ReactNode
  label: string
}

export function ModelSelectorScrollBody({
  children,
  label,
}: ModelSelectorScrollBodyProps) {
  return (
    <ScrollAreaRoot className="relative min-h-0 overflow-hidden overscroll-contain">
      <ScrollAreaViewport
        aria-label={label}
        className="max-h-[calc(min(624px,var(--available-height,624px))-84px)] overflow-x-hidden overscroll-contain"
        role="region"
      >
        <ScrollAreaContent className="min-w-0 overflow-x-hidden">{children}</ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar className="z-2 data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  )
}

export function CompatibleModelsNotice() {
  const { t } = useTranslation()

  return (
    <div
      data-testid="compatible-models-banner"
      className="px-4 py-2 system-xs-regular text-text-tertiary"
    >
      {t('modelProvider.selector.onlyCompatibleModelsShown', { ns: 'common' })}
    </div>
  )
}

type ModelProviderSettingsFooterProps = {
  onOpenSettings: () => void
}

export function ModelProviderSettingsFooter({
  onOpenSettings,
}: ModelProviderSettingsFooterProps) {
  const { t } = useTranslation()

  return (
    <div className="shrink-0 border-t border-divider-subtle p-1">
      <button
        type="button"
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
        onClick={onOpenSettings}
      >
        <span className="i-ri-equalizer-2-line h-4 w-4 shrink-0" />
        <span className="system-xs-medium">{t('modelProvider.selector.modelProviderSettings', { ns: 'common' })}</span>
      </button>
    </div>
  )
}
