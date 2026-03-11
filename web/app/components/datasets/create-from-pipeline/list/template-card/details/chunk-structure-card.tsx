import type { Option } from './types'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import { EffectColor } from './types'

const HEADER_EFFECT_MAP: Record<EffectColor, string> = {
  [EffectColor.indigo]: 'bg-util-colors-indigo-indigo-600 opacity-80',
  [EffectColor.blueLight]: 'bg-util-colors-blue-light-blue-light-500 opacity-80',
  [EffectColor.green]: 'bg-util-colors-teal-teal-600 opacity-80',
  [EffectColor.none]: '',
}

const IconBackgroundColorMap: Record<EffectColor, string> = {
  [EffectColor.indigo]: 'bg-components-icon-bg-indigo-solid',
  [EffectColor.blueLight]: 'bg-components-icon-bg-blue-light-solid',
  [EffectColor.green]: 'bg-components-icon-bg-teal-solid',
  [EffectColor.none]: '',
}

type ChunkStructureCardProps = {
  className?: string
} & Option

const ChunkStructureCard = ({
  className,
  icon,
  title,
  description,
  effectColor,
}: ChunkStructureCardProps) => {
  return (
    <div className={cn(
      'relative flex overflow-hidden rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-bg p-2 shadow-xs shadow-shadow-shadow-3',
      className,
    )}
    >
      <div className={cn(
        'absolute -left-1 -top-1 size-14 rounded-full blur-[80px]',
        `${HEADER_EFFECT_MAP[effectColor]}`,
      )}
      />
      <div className="p-1">
        <div className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-subtle text-text-primary-on-surface shadow-md shadow-shadow-shadow-5',
          `${IconBackgroundColorMap[effectColor]}`,
        )}
        >
          {icon}
        </div>
      </div>
      <div className="flex grow flex-col gap-y-0.5 py-px">
        <div className="flex items-center gap-x-1">
          <span className="system-sm-medium text-text-secondary">
            {title}
          </span>
        </div>
        {
          description && (
            <div className="system-xs-regular text-text-tertiary">
              {description}
            </div>
          )
        }
      </div>
    </div>
  )
}

export default React.memo(ChunkStructureCard) as typeof ChunkStructureCard
