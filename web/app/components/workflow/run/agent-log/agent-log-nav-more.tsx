import type { AgentLogItemWithChildren } from '@/types/workflow'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useTranslation } from 'react-i18next'

type AgentLogNavMoreProps = {
  options: AgentLogItemWithChildren[]
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
const AgentLogNavMore = ({ options, onShowAgentOrToolLog }: AgentLogNavMoreProps) => {
  const { t } = useTranslation(['common'])

  return (
    <Menu>
      <MenuTrigger
        render={
          <IconButton
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            size="md"
            variant="ghost-accent"
            className="rounded-lg"
          >
            <span aria-hidden className="i-ri-more-line size-4" />
          </IconButton>
        }
      />
      <MenuContent align="start" sideOffset={2} alignOffset={-54} className="w-34">
        {options.map((option) => (
          <MenuItem
            key={option.message_id}
            className="system-md-regular"
            onClick={() => onShowAgentOrToolLog(option)}
          >
            {option.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

export default AgentLogNavMore
