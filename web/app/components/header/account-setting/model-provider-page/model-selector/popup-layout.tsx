import type { FC, ReactNode } from 'react'
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

export const ModelSelectorPopupFrame: FC<ModelSelectorPopupFrameProps> = ({
  children,
}) => {
  return (
    <div className="flex max-h-[min(624px,var(--available-height,624px))] flex-col overflow-hidden rounded-xl bg-components-panel-bg">
      {children}
    </div>
  )
}

type ModelSelectorSearchHeaderProps = {
  searchText: string
  onSearchTextChange: (value: string) => void
}

export const ModelSelectorSearchHeader: FC<ModelSelectorSearchHeaderProps> = ({
  searchText,
  onSearchTextChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className="shrink-0 bg-components-panel-bg px-2 pt-2 pb-1">
      <div className={`
        flex h-8 items-center rounded-lg border px-2
        ${searchText ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs' : 'border-transparent bg-components-input-bg-normal'}
      `}
      >
        <span
          className={`
            mr-0.5 i-ri-search-line h-4 w-4 shrink-0
            ${searchText ? 'text-text-tertiary' : 'text-text-quaternary'}
          `}
        />
        <input
          className="block h-[18px] grow appearance-none bg-transparent px-1 text-[13px] text-text-primary outline-hidden"
          placeholder={t('form.searchModel', { ns: 'datasetSettings' }) || ''}
          value={searchText}
          onChange={e => onSearchTextChange(e.target.value)}
        />
        {
          searchText && (
            <span
              className="ml-1.5 i-custom-vender-solid-general-x-circle h-[14px] w-[14px] shrink-0 cursor-pointer text-text-quaternary"
              onClick={() => onSearchTextChange('')}
            />
          )
        }
      </div>
    </div>
  )
}

type ModelSelectorScrollBodyProps = {
  children: ReactNode
  label: string
}

export const ModelSelectorScrollBody: FC<ModelSelectorScrollBodyProps> = ({
  children,
  label,
}) => {
  return (
    <ScrollAreaRoot className="relative min-h-0 overflow-hidden overscroll-contain">
      <ScrollAreaViewport
        aria-label={label}
        className="max-h-[calc(min(624px,var(--available-height,624px))-84px)] overscroll-contain"
        role="region"
      >
        <ScrollAreaContent className="min-w-0">
          {children}
        </ScrollAreaContent>
      </ScrollAreaViewport>
      {/* Keep the overlay scrollbar above sticky provider headers inside this scroll area. */}
      <ScrollAreaScrollbar className="z-2 data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  )
}

export const CompatibleModelsNotice = () => {
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

export const ModelProviderSettingsFooter: FC<ModelProviderSettingsFooterProps> = ({
  onOpenSettings,
}) => {
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
