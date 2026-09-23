'use client'

import { useShallow } from 'zustand/react/shallow'
import { SnippetCollapsedPreview } from '@/app/components/snippets/components/snippet-collapsed-preview'
import { SnippetSidebarContent } from '@/app/components/snippets/components/snippet-sidebar'
import { useSnippetDraftStore } from '@/app/components/snippets/draft-store'
import { useSnippetDetailStore } from '@/app/components/snippets/store'
import { usePathname } from '@/next/navigation'

type SnippetDetailSectionProps = {
  expand: boolean
}

export function SnippetDetailSection({ expand }: SnippetDetailSectionProps) {
  const pathname = usePathname()
  const section = pathname.endsWith('/evaluation') ? 'evaluation' : 'orchestrate'
  const snippetNavigation = useSnippetDetailStore(
    useShallow((state) => ({
      onFieldsChange: state.onFieldsChange,
      readonly: state.readonly,
      snippet: state.snippet,
    })),
  )
  const snippetInputFields = useSnippetDraftStore((state) => state.inputFields)

  if (!expand)
    return (
      <SnippetCollapsedPreview
        inputFieldCount={snippetInputFields.length}
        snippetId={snippetNavigation.snippet?.id}
        section={section}
        isPublished={snippetNavigation.snippet?.is_published}
      />
    )

  if (
    !snippetNavigation.snippet ||
    (section === 'orchestrate' && !snippetNavigation.onFieldsChange)
  )
    return null

  return (
    <SnippetSidebarContent
      snippet={snippetNavigation.snippet}
      section={section}
      fields={snippetInputFields}
      readonly={snippetNavigation.readonly}
      onFieldsChange={snippetNavigation.onFieldsChange}
    />
  )
}
