'use client'
import type { FC } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import Divider from '@/app/components/base/divider'
import {
  AuthCategory,
  PluginAuthInAgent,
} from '@/app/components/plugins/plugin-auth'
import { CollectionType } from '@/app/components/tools/types'

type ToolAuthorizationSectionProps = {
  currentProvider?: ToolWithProvider
  credentialId?: string
  onAuthorizationItemClick: (id: string) => void
}

const ToolAuthorizationSection: FC<ToolAuthorizationSectionProps> = ({
  currentProvider,
  credentialId,
  onAuthorizationItemClick,
}) => {
  // Only show for built-in providers that allow deletion
  const shouldShow = currentProvider
    && currentProvider.type === CollectionType.builtIn
    && currentProvider.allow_delete

  if (!shouldShow)
    return null

  return (
    <>
      <Divider className="my-1 w-full" />
      <div className="px-4 py-2">
        <PluginAuthInAgent
          pluginPayload={{
            provider: currentProvider.name,
            category: AuthCategory.tool,
            providerType: currentProvider.type,
          }}
          credentialId={credentialId}
          onAuthorizationItemClick={onAuthorizationItemClick}
        />
      </div>
    </>
  )
}

export default ToolAuthorizationSection
