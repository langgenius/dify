'use client'

import { useTranslation } from 'react-i18next'

type WebAppAccessControlEntryProps = {
  accessConfigured: boolean
  accessIcon: string
  accessLabel: string
  available: boolean
  disabled: boolean
  onClick: () => void
}

export function WebAppAccessControlEntry({
  accessConfigured,
  accessIcon,
  accessLabel,
  available,
  disabled,
  onClick,
}: WebAppAccessControlEntryProps) {
  const { t } = useTranslation()

  return (
    <div className="-mt-1 px-4 pb-3">
      {available ? (
        <button
          type="button"
          className="flex h-9 w-full cursor-pointer items-center gap-x-0.5 rounded-lg border-[0.5px] border-divider-subtle bg-background-section py-1 pr-2 pl-2.5 text-left outline-hidden hover:bg-state-base-hover-alt focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:hover:bg-background-section"
          disabled={disabled}
          onClick={onClick}
        >
          <div className="flex grow items-center gap-x-1.5 overflow-hidden pr-1">
            <span aria-hidden className={`${accessIcon} size-4 shrink-0 text-text-secondary`} />
            <div className="grow truncate">
              <span className="system-sm-regular text-text-secondary">{accessLabel}</span>
            </div>
          </div>
          {!accessConfigured && (
            <span className="shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['publishApp.notSet'], { ns: 'app' })}
            </span>
          )}
          <div className="flex size-4 shrink-0 items-center justify-center">
            <span aria-hidden className="i-ri-arrow-right-s-line size-4 text-text-quaternary" />
          </div>
        </button>
      ) : (
        <div className="flex h-9 w-full items-center gap-2 rounded-lg border-[0.5px] border-divider-subtle bg-background-section px-2.5">
          <span aria-hidden className="i-ri-global-line size-4 shrink-0 text-text-disabled" />
          <span className="h-2 w-[42%] rounded-full bg-text-quaternary opacity-10" />
          <span
            aria-hidden
            className="ml-auto i-ri-arrow-right-s-line size-4 shrink-0 text-text-disabled"
          />
        </div>
      )}
    </div>
  )
}
