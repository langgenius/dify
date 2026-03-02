'use client'
import { useTheme } from 'next-themes'
import { cn } from '@/utils/classnames'

export type Theme = 'light' | 'dark' | 'system'

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme)
  }

  return (
    <div className="flex items-center rounded-[10px] bg-components-segmented-control-bg-normal p-0.5">
      <div
        className={cn(
          'rounded-lg px-2 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          theme === 'system' && 'bg-components-segmented-control-item-active-bg text-text-accent-light-mode-only shadow-sm hover:bg-components-segmented-control-item-active-bg hover:text-text-accent-light-mode-only',
        )}
        onClick={() => handleThemeChange('system')}
        data-testid="system-theme-container"
      >
        <div className="p-0.5">
          <span className="i-ri-computer-line h-4 w-4" />
        </div>
      </div>
      <div className={cn('h-[14px] w-px bg-transparent', theme === 'dark' && 'bg-divider-regular')} data-testid="divider"></div>
      <div
        className={cn(
          'rounded-lg px-2 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          theme === 'light' && 'bg-components-segmented-control-item-active-bg text-text-accent-light-mode-only shadow-sm hover:bg-components-segmented-control-item-active-bg hover:text-text-accent-light-mode-only',
        )}
        onClick={() => handleThemeChange('light')}
        data-testid="light-theme-container"
      >
        <div className="p-0.5">
          <span className="i-ri-sun-line h-4 w-4" />
        </div>
      </div>
      <div className={cn('h-[14px] w-px bg-transparent', theme === 'system' && 'bg-divider-regular')} data-testid="divider"></div>
      <div
        className={cn(
          'rounded-lg px-2 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          theme === 'dark' && 'bg-components-segmented-control-item-active-bg text-text-accent-light-mode-only shadow-sm hover:bg-components-segmented-control-item-active-bg hover:text-text-accent-light-mode-only',
        )}
        onClick={() => handleThemeChange('dark')}
        data-testid="dark-theme-container"
      >
        <div className="p-0.5">
          <span className="i-ri-moon-line h-4 w-4" />
        </div>
      </div>
    </div>
  )
}
