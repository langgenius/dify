import type { AgentFormSource } from '../agent-form'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { useMutation } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { DuplicateAgentDialogContent } from '../duplicate-agent-dialog'
import { EditAgentDialogContent } from '../edit-agent-dialog'

type AgentDialogHarnessProps = {
  agent: AgentFormSource
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditAgentDialog({ agent, open, onOpenChange }: AgentDialogHarnessProps) {
  const agentUpdate = useMutation(consoleQuery.agent.byAgentId.put.mutationOptions())

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && agentUpdate.isPending) details.cancel()
        else onOpenChange(nextOpen)
      }}
    >
      <EditAgentDialogContent
        agent={agent}
        pending={agentUpdate.isPending}
        onSubmit={(body) =>
          agentUpdate.mutate(
            { params: { agent_id: agent.id }, body },
            { onSuccess: () => onOpenChange(false) },
          )
        }
      />
    </Dialog>
  )
}

export function DuplicateAgentDialog({ agent, open, onOpenChange }: AgentDialogHarnessProps) {
  const agentCopy = useMutation(consoleQuery.agent.byAgentId.copy.post.mutationOptions())

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && agentCopy.isPending) details.cancel()
        else onOpenChange(nextOpen)
      }}
    >
      <DuplicateAgentDialogContent
        agent={agent}
        pending={agentCopy.isPending}
        onSubmit={(body) =>
          agentCopy.mutate(
            { params: { agent_id: agent.id }, body },
            { onSuccess: () => onOpenChange(false) },
          )
        }
      />
    </Dialog>
  )
}
