import { cn } from '@langgenius/dify-ui/cn'

const CLAUDE = /claude|anthropic/i
const CODEX = /codex|openai|chatgpt/i

/**
 * A small mark for an agent or token, so rows of connections are not text only.
 * Clients name themselves, so the match is a hint for the eye, never an identity check.
 */
export function AgentIcon({
  className,
  name,
  personal = false,
}: {
  className?: string
  name?: string | null
  personal?: boolean
}) {
  const icon = personal
    ? 'i-ri-key-2-line text-text-tertiary'
    : name && CLAUDE.test(name)
      ? 'i-ri-claude-fill text-[#D97757]'
      : name && CODEX.test(name)
        ? 'i-ri-openai-fill text-text-primary'
        : 'i-custom-vender-other-mcp text-text-tertiary'
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg',
        className,
      )}
    >
      <span className={cn('size-3.5', icon)} />
    </span>
  )
}
