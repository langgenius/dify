import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type ModelTriggerProps = {
  open: boolean
  className?: string
}
const ModelTrigger: FC<ModelTriggerProps> = ({
  open,
  className,
}) => {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'group flex h-8 cursor-pointer items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 hover:bg-components-input-bg-hover',
        open && 'bg-components-input-bg-hover',
        className,
      )}
    >
      <div className="flex h-6 w-6 items-center justify-center">
        <div className="flex h-5 w-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
          <span className="i-ri-brain-2-line h-3.5 w-3.5 text-text-quaternary" />
        </div>
      </div>
      <div className="flex grow items-center gap-1 truncate px-1 py-[3px]">
        <div
          className="truncate text-[13px] text-text-quaternary"
          title="Configure model"
        >
          {t('detailPanel.configureModel', { ns: 'plugin' })}
        </div>
      </div>
      <div className="flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="i-ri-arrow-down-s-line h-3.5 w-3.5 text-text-tertiary" />
      </div>
    </div>
  )
}

export default ModelTrigger
