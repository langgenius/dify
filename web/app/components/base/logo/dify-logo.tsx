'use client'
import type { FC } from 'react'
import useTheme from '@/hooks/use-theme'
import { cn } from '@/utils/classnames'
import { basePath } from '@/utils/var'

export type LogoStyle = 'default' | 'monochromeWhite'

export const logoPathMap: Record<LogoStyle, string> = {
  default: '/logo/logo.svg',
  monochromeWhite: '/logo/logo-monochrome-white.svg',
}

export type LogoSize = 'large' | 'medium' | 'small'

export const logoSizeMap: Record<LogoSize, string> = {
  large: 'w-16 h-7',
  medium: 'w-12 h-[22px]',
  small: 'w-9 h-4',
}

const aceBadgePath = '/logo/acedatacloud-badge.svg'

const aceBadgeSizeMap: Record<LogoSize, string> = {
  large: 'w-4 h-4',
  medium: 'w-3 h-3',
  small: 'w-2.5 h-2.5',
}

const aceBadgePosMap: Record<LogoSize, string> = {
  large: '-right-2 -bottom-2',
  medium: '-right-2 -bottom-2',
  small: '-right-2 -bottom-2',
}

type DifyLogoProps = {
  style?: LogoStyle
  size?: LogoSize
  withAceBadge?: boolean
  className?: string
}

const DifyLogo: FC<DifyLogoProps> = ({
  style = 'default',
  size = 'medium',
  withAceBadge = true,
  className,
}) => {
  const { theme } = useTheme()
  const themedStyle = (theme === 'dark' && style === 'default') ? 'monochromeWhite' : style

  return (
    <span className="relative inline-block align-middle">
      <img
        src={`${basePath}${logoPathMap[themedStyle]}`}
        className={cn('block object-contain', logoSizeMap[size], className)}
        alt="Dify logo"
      />
      {withAceBadge && (
        <span
          className={cn(
            'pointer-events-none absolute flex items-center justify-center overflow-hidden rounded-full border-[0.5px] border-components-panel-border bg-background-default p-[1px]',
            aceBadgeSizeMap[size],
            aceBadgePosMap[size],
          )}
          aria-hidden="true"
        >
          <img
            src={`${basePath}${aceBadgePath}`}
            className="h-full w-full"
            alt=""
          />
        </span>
      )}
    </span>
  )
}

export default DifyLogo
