import type { ComponentProps } from 'react'
import { QueryTestingAdapter as RegisteredQueryTestingAdapter } from 'nuqs-jotai/testing'
import { newRagQueryGroups } from '@/features/new-rag/query-groups'

export function QueryTestingAdapter(
  props: Omit<ComponentProps<typeof RegisteredQueryTestingAdapter>, 'groups'>,
) {
  return <RegisteredQueryTestingAdapter groups={newRagQueryGroups} hasMemory {...props} />
}
