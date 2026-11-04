'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

type AppTriggerProps = ComponentProps<'button'> & {
  appDetail?: Pick<
    AppPartial,
    'icon' | 'icon_background' | 'icon_type' | 'icon_url' | 'id' | 'name'
  >
}

export function AppTrigger({ appDetail, className, ...props }: AppTriggerProps) {
  const { t } = useTranslation(['app'])

  return (
    <button
      {...props}
      type="button"
      className={cn(
        'group flex w-full min-w-0 cursor-pointer items-center rounded-lg bg-components-input-bg-normal p-2 ps-3 text-start hover:bg-state-base-hover-alt disabled:cursor-not-allowed data-popup-open:bg-state-base-hover-alt',
        appDetail && 'py-1.5 ps-1.5',
        className,
      )}
    >
      {appDetail && <AppIcon className="me-2 shrink-0" size="xs" icon={appDetail} />}
      {appDetail ? (
        <span className="min-w-0 grow truncate system-sm-medium text-components-input-text-filled">
          {appDetail.name}
        </span>
      ) : (
        <span className="min-w-0 grow truncate system-sm-regular text-components-input-text-placeholder">
          {t(($) => $['appSelector.placeholder'], { ns: 'app' })}
        </span>
      )}
      <span
        className="ms-0.5 i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary group-hover:text-text-secondary group-data-popup-open:text-text-secondary"
        aria-hidden="true"
      />
    </button>
  )
}
