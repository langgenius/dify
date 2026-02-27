import type { FC } from 'react'
import { memo } from 'react'
import { cn } from '@/utils/classnames'

type DatasourceIconProps = {
  size?: string
  className?: string
  iconUrl: string
}

const ICON_CONTAINER_CLASSNAME_SIZE_MAP: Record<string, string> = {
  xs: 'w-4 h-4 rounded-[5px] shadow-xs',
  sm: 'w-5 h-5 rounded-md shadow-xs',
  md: 'w-6 h-6 rounded-lg shadow-md',
}

const DatasourceIcon: FC<DatasourceIconProps> = ({
  size = 'sm',
  className,
  iconUrl,
}) => {
  return (
    <div className={
      cn(
        'flex items-center justify-center shadow-none',
        ICON_CONTAINER_CLASSNAME_SIZE_MAP[size],
        className,
      )
    }
    >
      <div
        className="h-full w-full shrink-0 rounded-md bg-cover bg-center"
        style={{
          backgroundImage: `url(${iconUrl})`,
        }}
      />
    </div>
  )
}

export default memo(DatasourceIcon)
