'use client'

import type { ReactNode } from 'react'
import type { EditorResource } from './resource'
import { ScopeProvider } from 'jotai-scope'
import { getEditorResourceId } from './resource'
import { editorResourceAtom } from './state'

export function EditorResourceScope({
  resource,
  children,
}: {
  resource: EditorResource
  children: ReactNode
}) {
  return (
    <ScopeProvider
      key={`${resource.kind}:${getEditorResourceId(resource)}`}
      atoms={[[editorResourceAtom, resource]]}
      name="WorkflowEditor"
    >
      {children}
    </ScopeProvider>
  )
}
