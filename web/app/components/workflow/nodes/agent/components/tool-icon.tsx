import Tooltip from '@/app/components/base/tooltip'
import Indicator from '@/app/components/header/indicator'
import classNames from '@/utils/classnames'
import { useRef } from 'react'

export type ToolIconProps = {
  src: string
  alt?: string
  status?: 'error' | 'warning'
  tooltip?: string
}

export const ToolIcon = ({ src, status, tooltip, alt }: ToolIconProps) => {
  const indicator = status === 'error' ? 'red' : status === 'warning' ? 'yellow' : undefined
  const containerRef = useRef<HTMLDivElement>(null)
  const notSuccess = (['error', 'warning'] as Array<ToolIconProps['status']>).includes(status)
  return <Tooltip triggerMethod='hover' popupContent={tooltip} disabled={!notSuccess}>
    <div className={classNames(
      'size-5 border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge relative',
    )}
    ref={containerRef}
    >
      <img
        src={src}
        alt={alt}
        className={classNames(
          'w-full h-full max-w-5 max-h-5 object-cover rounded-[6px]',
          notSuccess && 'opacity-50',
        )}
      />
      {indicator && <Indicator color={indicator} className="absolute right-[-1px] top-[-1px]" />}
    </div>
  </Tooltip>
}
