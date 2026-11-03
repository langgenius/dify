'use client'

import * as React from 'react'
import ChatWithHistoryWrap from '@/app/components/base/chat/chat-with-history'
import { AgentRosterResponseContent } from '@/app/components/base/chat/chat/answer/agent-roster-response-content'
import { useWebAppStore } from '@/context/web-app-context'
import AuthenticatedLayout from '../../components/authenticated-layout'

function AgentShareRosterContent(props: React.ComponentProps<typeof AgentRosterResponseContent>) {
  const showThoughts = useWebAppStore((state) => state.appParams?.show_thoughts?.enabled ?? false)
  return <AgentRosterResponseContent {...props} showThoughts={showThoughts} />
}

function renderAgentContent(props: React.ComponentProps<typeof AgentRosterResponseContent>) {
  return <AgentShareRosterContent {...props} />
}

function Agent() {
  return (
    <AuthenticatedLayout>
      <ChatWithHistoryWrap isNewAgent renderAgentContent={renderAgentContent} />
    </AuthenticatedLayout>
  )
}

export default React.memo(Agent)
