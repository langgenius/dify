import type { WorkflowTheme } from '../theme'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { cn } from '@/utils/classnames'
import { useWorkflowTheme } from '../hooks/use-workflow-theme'
import {
  normalizeWorkflowTheme,
  saveWorkflowThemeToStorage,
} from '../theme'

type WorkflowThemeOption = {
  value: WorkflowTheme
  label: string
  dotClassName: string
}

const ThemeSwitcher = () => {
  const { t } = useTranslation()
  const workflowTheme = useWorkflowTheme()
  const workflowThemeOptions = useMemo<WorkflowThemeOption[]>(() => [
    {
      value: 'default',
      label: t('operator.themeDefault', { ns: 'workflow' }),
      dotClassName: 'bg-[#8B9BB0]',
    },
    {
      value: 'ocean',
      label: t('operator.themeOcean', { ns: 'workflow' }),
      dotClassName: 'bg-[#0B84D8]',
    },
    {
      value: 'sunset',
      label: t('operator.themeSunset', { ns: 'workflow' }),
      dotClassName: 'bg-[#EA580C]',
    },
  ], [t])

  const handleThemeChange = useCallback((value: WorkflowTheme) => {
    const nextTheme = normalizeWorkflowTheme(value)
    if (nextTheme === workflowTheme)
      return

    saveWorkflowThemeToStorage(nextTheme)
  }, [workflowTheme])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('operator.theme', { ns: 'workflow' })}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover hover:text-text-secondary"
      >
        <span aria-hidden className="i-ri-palette-line h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="right-start"
        sideOffset={8}
        popupClassName="w-[180px] !bg-components-panel-bg-blur backdrop-blur-sm"
      >
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>{t('operator.theme', { ns: 'workflow' })}</DropdownMenuGroupLabel>
          {workflowThemeOptions.map(option => (
            <DropdownMenuItem
              key={option.value}
              className="justify-between"
              onClick={() => handleThemeChange(option.value)}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn('h-2.5 w-2.5 rounded-full border border-divider-subtle', option.dotClassName)}
                />
                {option.label}
              </span>
              <span
                aria-hidden
                className={cn('i-ri-check-line h-4 w-4 text-text-tertiary', workflowTheme === option.value ? 'opacity-100' : 'opacity-0')}
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default memo(ThemeSwitcher)
