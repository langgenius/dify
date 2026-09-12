'use client'

import { useTranslation } from 'react-i18next'

export function AccessControlRestrictedPreview() {
  const { t } = useTranslation()

  return (
    <div
      aria-hidden="true"
      className="flex h-50 w-full flex-col overflow-hidden rounded-lg border border-components-panel-border bg-background-default shadow-md"
    >
      <div className="flex h-6 items-center gap-1.75 border-b border-divider-subtle bg-background-body px-1">
        <div className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-[#ff5f57]" />
          <span className="size-1.5 rounded-full bg-[#febc2e]" />
          <span className="size-1.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex items-center gap-0.75">
          <span className="flex size-3 items-center justify-center overflow-hidden rounded-sm border-[0.5px] border-divider-regular bg-components-icon-bg-teal-soft text-[7px] leading-none">
            🤖
          </span>
          <span className="text-[6px] leading-2 text-text-secondary">
            {t(($) => $['studio.accessControl.previewAppName'], { ns: 'deployments' })}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col bg-background-default-hover p-1">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded bg-linear-to-t from-background-default/16 to-background-default">
          <div className="relative size-9">
            <span className="i-ri-global-line size-9 text-text-accent" />
            <span className="absolute top-5 left-5.75 flex size-4 items-center justify-center rounded-full bg-background-default">
              <span className="i-ri-information-2-fill size-4 text-text-accent" />
            </span>
          </div>
          <p className="w-44 text-center system-2xs-regular text-text-primary">
            {t(($) => $['studio.accessControl.previewCaption'], { ns: 'deployments' })}
          </p>
        </div>
      </div>
    </div>
  )
}
