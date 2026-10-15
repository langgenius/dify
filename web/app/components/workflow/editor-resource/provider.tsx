'use client'

import type { ReactNode } from 'react'
import type { EditorIdentity } from './state'
import { ScopeProvider } from 'jotai-scope'
import { editorIdentityStateAtom } from './state'

export function EditorResourceScope({
  identity,
  children,
}: {
  identity: EditorIdentity
  children: ReactNode
}) {
  const id =
    identity.kind === 'app'
      ? identity.appId
      : identity.kind === 'knowledge-pipeline'
        ? identity.pipelineId
        : identity.snippetId

  return (
    <ScopeProvider
      key={`${identity.kind}:${id}`}
      atoms={[[editorIdentityStateAtom, identity]]}
      name="WorkflowEditor"
    >
      {children}
    </ScopeProvider>
  )
}
