'use client'
import * as React from 'react'
import dynamic from '@/next/dynamic'
import { useWorkflowGeneratorStore } from './store'

// Lazy-load the modal so the bundle of the common layout stays light;
// the modal is only mounted on demand when cmd+k `/create` fires.
const WorkflowGeneratorModal = dynamic(() => import('./index'), { ssr: false })

/**
 * Global mount point for the workflow generator modal. Place once in the
 * common layout next to ``<GotoAnything />`` — the modal opens whenever the
 * zustand store flips ``isOpen`` to true.
 */
const WorkflowGeneratorMount: React.FC = () => {
  const isOpen = useWorkflowGeneratorStore(s => s.isOpen)
  if (!isOpen)
    return null
  return <WorkflowGeneratorModal />
}

export default WorkflowGeneratorMount
