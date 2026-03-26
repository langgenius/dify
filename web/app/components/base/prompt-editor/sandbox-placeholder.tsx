import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type SandboxPlaceholderTokenProps = {
  actionLabel?: string
  shortcut: '/' | '@'
}

const SandboxPlaceholderToken: FC<SandboxPlaceholderTokenProps> = ({
  actionLabel,
  shortcut,
}) => {
  return (
    <span
      className={cn(
        'inline-flex cursor-pointer items-center gap-1 text-text-tertiary hover:text-components-button-secondary-accent-text',
        'group/placeholder-token',
      )}
    >
      <span
        className={cn(
          'inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-1 system-kbd',
          'group-hover/placeholder-token:bg-components-button-secondary-accent-text-disabled',
        )}
      >
        {shortcut}
      </span>
      <span
        className={cn(
          'pointer-events-auto border-b border-dotted border-current px-0.5 transition-colors',
        )}
      >
        {actionLabel}
      </span>
    </span>
  )
}

type SandboxPlaceholderProps = {
  disableToolBlocks?: boolean
  isSupportSandbox?: boolean
}

const SandboxPlaceholder: FC<SandboxPlaceholderProps> = ({
  disableToolBlocks,
  isSupportSandbox,
}) => {
  const { t } = useTranslation()

  if (!isSupportSandbox)
    return null

  return (
    <span>
      {t('promptEditor.placeholderSandboxPrefix', { ns: 'common' })}
      <SandboxPlaceholderToken
        shortcut="/"
        actionLabel={t('promptEditor.placeholderSandboxInsert', { ns: 'common' })}
      />
      {!disableToolBlocks && (
        <>
          {t('promptEditor.placeholderSandboxSeparator', { ns: 'common' })}
          <SandboxPlaceholderToken
            shortcut="@"
            actionLabel={t('promptEditor.placeholderSandboxTools', { ns: 'common' })}
          />
        </>
      )}
    </span>
  )
}

export default SandboxPlaceholder
