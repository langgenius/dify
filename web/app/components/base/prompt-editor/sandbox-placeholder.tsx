import type { FC, MouseEvent } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $insertNodes } from 'lexical'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import { $createCustomTextNode } from './plugins/custom-text/node'

type SandboxPlaceholderTokenProps = {
  actionLabel?: string
  onClick?: () => void
  shortcut: '/' | '@'
}

const SandboxPlaceholderToken: FC<SandboxPlaceholderTokenProps> = ({
  actionLabel,
  onClick,
  shortcut,
}) => {
  const handleMouseDown = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
  }

  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={handleMouseDown}
      onClick={onClick}
      className={cn(
        'pointer-events-auto inline-flex appearance-none items-center gap-1 bg-transparent p-0 text-text-tertiary',
        'cursor-pointer hover:text-components-button-secondary-accent-text',
        'disabled:cursor-default disabled:hover:text-text-tertiary',
        'group/placeholder-token',
      )}
      disabled={!onClick}
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
          'border-b border-dotted border-current px-0.5 transition-colors',
        )}
      >
        {actionLabel}
      </span>
    </button>
  )
}

type SandboxPlaceholderProps = {
  editable?: boolean
  disableToolBlocks?: boolean
  isSupportSandbox?: boolean
}

const SandboxPlaceholder: FC<SandboxPlaceholderProps> = ({
  editable = true,
  disableToolBlocks,
  isSupportSandbox,
}) => {
  const [editor] = useLexicalComposerContext()
  const { t } = useTranslation()

  const handleQuickInsert = useCallback((trigger: '/' | '@') => {
    editor.focus(() => {
      editor.update(() => {
        $getRoot().selectEnd()
        $insertNodes([$createCustomTextNode(trigger)])
      })
    })
  }, [editor])

  if (!isSupportSandbox)
    return null

  return (
    <span>
      {t('promptEditor.placeholderSandboxPrefix', { ns: 'common' })}
      <SandboxPlaceholderToken
        shortcut="/"
        onClick={editable ? () => handleQuickInsert('/') : undefined}
        actionLabel={t('promptEditor.placeholderSandboxInsert', { ns: 'common' })}
      />
      {!disableToolBlocks && (
        <>
          {t('promptEditor.placeholderSandboxSeparator', { ns: 'common' })}
          <SandboxPlaceholderToken
            shortcut="@"
            onClick={editable ? () => handleQuickInsert('@') : undefined}
            actionLabel={t('promptEditor.placeholderSandboxTools', { ns: 'common' })}
          />
        </>
      )}
    </span>
  )
}

export default SandboxPlaceholder
