import type { ReactNode } from 'react'
import PluginDependency from '@/app/components/workflow/plugin-dependency'
import { guardAgentV2Route } from './feature-guard'

export default function Layout({ children }: { children: ReactNode }) {
  guardAgentV2Route()

  return (
    <>
      <PluginDependency />
      {children}
    </>
  )
}
