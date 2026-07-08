'use client'

import * as React from 'react'
import ChatWithHistoryWrap from '@/app/components/base/chat/chat-with-history'
import { AgentRosterResponseContent } from '@/app/components/base/chat/chat/answer/agent-roster-response-content'
import AuthenticatedLayout from '../../components/authenticated-layout'

function Agent() {
  return (
    <AuthenticatedLayout>
      <ChatWithHistoryWrap renderAgentContent={AgentRosterResponseContent} />
    </AuthenticatedLayout>
  )
}

export default React.memo(Agent)
