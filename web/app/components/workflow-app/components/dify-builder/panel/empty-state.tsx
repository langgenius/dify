import { useTranslation } from 'react-i18next'

export const DifyBuilderPanelEmptyState = () => {
  const { t } = useTranslation()

  return (
    <div className="mx-4 flex h-full flex-col items-center justify-center gap-3 rounded-[10px] px-4 py-16 text-center">
      <div
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg p-1 shadow-[0_4px_6px_-2px_var(--color-shadow-shadow-1),0_12px_16px_-4px_var(--color-shadow-shadow-5)] backdrop-blur-[5px]"
      >
        <span className="i-custom-public-app-builder-builder-mark-24 size-6 shrink-0 [html[data-theme=dark]_&]:brightness-0 [html[data-theme=dark]_&]:invert" />
      </div>
      <div className="flex w-full flex-col gap-1 wrap-break-word">
        <h3 className="system-xl-medium text-text-secondary">
          {t(($) => $['difyBuilder.emptyBuildTitle'], { ns: 'workflow' })}
        </h3>
        <p className="system-xs-regular text-pretty text-text-tertiary">
          {t(($) => $['difyBuilder.emptyDescription'], { ns: 'workflow' })}
        </p>
      </div>
    </div>
  )
}
