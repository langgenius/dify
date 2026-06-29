'use client'
import type { FC } from 'react'
import { CheckboxSkeleton } from '@langgenius/dify-ui/checkbox'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from '#i18n'
import { LoadingPlaceholder } from '@/app/components/plugins/card/base/placeholder'
import { Group } from '../../../base/icons/src/vender/other'

const LoadingError: FC = () => {
  const { t } = useTranslation()
  return (
    <div className="flex items-center space-x-2">
      <CheckboxSkeleton
        className="shrink-0"
      />
      <div className="hover-bg-components-panel-on-panel-item-bg relative grow rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 pb-3 shadow-xs">
        <div className="flex">
          <div
            className="relative flex h-10 w-10 items-center justify-center gap-2 rounded-[10px] border-[0.5px]
              border-state-destructive-border bg-state-destructive-hover p-1 backdrop-blur-xs"
          >
            <div className="flex size-5 items-center justify-center">
              <Group className="text-text-quaternary" />
            </div>
            <div className="absolute right-[-4px] bottom-[-4px] rounded-full border-2 border-components-panel-bg bg-state-destructive-solid">
              <RiCloseLine className="size-3 text-text-primary-on-surface" />
            </div>
          </div>
          <div className="ml-3 grow">
            <div className="flex h-5 items-center system-md-semibold text-text-destructive">
              {t('installModal.pluginLoadError', { ns: 'plugin' })}
            </div>
            <div className="mt-0.5 system-xs-regular text-text-tertiary">
              {t('installModal.pluginLoadErrorDesc', { ns: 'plugin' })}
            </div>
          </div>
        </div>
        <LoadingPlaceholder className="mt-3 w-[420px]" />
      </div>
    </div>
  )
}
export default React.memo(LoadingError)
