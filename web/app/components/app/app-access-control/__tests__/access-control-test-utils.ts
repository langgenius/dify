import type { ReactNode } from 'react'
import type { AccessControlDraft, AccessControlStore } from '../store'
import { createElement } from 'react'
import { AccessMode } from '@/models/access-control'
import { useAccessControlStore } from '../store'
import { AccessControlDraftProvider } from '../store-provider'

const emptyDraft = {
  appId: '',
  currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS,
  specificGroups: [],
  specificMembers: [],
  selectedGroupsForBreadcrumb: [],
} satisfies Required<AccessControlDraft>

function draftKey(draft: AccessControlDraft) {
  return [
    draft.appId ?? '',
    draft.currentMenu,
    draft.specificGroups?.map(group => group.id).join(',') ?? '',
    draft.specificMembers?.map(member => member.id).join(',') ?? '',
    draft.selectedGroupsForBreadcrumb?.map(group => group.id).join(',') ?? '',
  ].join(':')
}

function completeDraft(initialDraft: Partial<AccessControlDraft> = {}): Required<AccessControlDraft> {
  return {
    ...emptyDraft,
    ...initialDraft,
  }
}

function SnapshotProbe({ onSnapshot }: {
  onSnapshot: (snapshot: AccessControlStore) => void
}) {
  onSnapshot(useAccessControlStore(state => state))
  return null
}

export function createAccessControlDraftHarness(
  children: ReactNode,
  initialDraft?: Partial<AccessControlDraft>,
) {
  const draft = completeDraft(initialDraft)
  let snapshot: AccessControlStore = {
    appId: draft.appId,
    specificGroups: draft.specificGroups,
    setSpecificGroups: () => undefined,
    specificMembers: draft.specificMembers,
    setSpecificMembers: () => undefined,
    currentMenu: draft.currentMenu,
    setCurrentMenu: () => undefined,
    selectedGroupsForBreadcrumb: draft.selectedGroupsForBreadcrumb,
    setSelectedGroupsForBreadcrumb: () => undefined,
  }

  return {
    element: createElement(
      AccessControlDraftProvider,
      {
        draftKey: draftKey(draft),
        initialDraft: draft,
      },
      createElement(SnapshotProbe, {
        onSnapshot: nextSnapshot => snapshot = nextSnapshot,
      }),
      children,
    ),
    getSnapshot: () => snapshot,
  }
}
