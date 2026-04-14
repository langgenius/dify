import type { AppDetailResponse } from '@/models/app'
import { BlockEnum } from '@/app/components/workflow/types'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import { getAppCardDisplayState, getAppCardOperationKeys, hasWorkflowStartNode, isAppAccessConfigured } from '../app-card-utils'

describe('app-card-utils', () => {
  const baseAppInfo = {
    id: 'app-1',
    mode: AppModeEnum.CHAT,
    enable_site: true,
    enable_api: false,
    access_mode: AccessMode.PUBLIC,
    api_base_url: 'https://api.example.com',
    site: {
      app_base_url: 'https://example.com',
      access_token: 'token-1',
    },
  } as AppDetailResponse

  it('should detect whether the workflow includes a start node', () => {
    expect(hasWorkflowStartNode({
      graph: {
        nodes: [{ data: { type: BlockEnum.Start } }],
      },
    })).toBe(true)

    expect(hasWorkflowStartNode({
      graph: {
        nodes: [{ data: { type: BlockEnum.Answer } }],
      },
    })).toBe(false)
  })

  it('should build the display state for a published web app', () => {
    const state = getAppCardDisplayState({
      appInfo: baseAppInfo,
      cardType: 'webapp',
      currentWorkflow: null,
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceManager: true,
    })

    expect(state.isApp).toBe(true)
    expect(state.appMode).toBe(AppModeEnum.CHAT)
    expect(state.runningStatus).toBe(true)
    expect(state.accessibleUrl).toBe(`https://example.com${basePath}/chat/token-1`)
  })

  it('should disable workflow cards without a graph or start node', () => {
    const unpublishedState = getAppCardDisplayState({
      appInfo: { ...baseAppInfo, mode: AppModeEnum.WORKFLOW },
      cardType: 'webapp',
      currentWorkflow: null,
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceManager: true,
    })
    expect(unpublishedState.appUnpublished).toBe(true)
    expect(unpublishedState.toggleDisabled).toBe(true)

    const missingStartState = getAppCardDisplayState({
      appInfo: { ...baseAppInfo, mode: AppModeEnum.WORKFLOW },
      cardType: 'webapp',
      currentWorkflow: {
        graph: {
          nodes: [{ data: { type: BlockEnum.Answer } }],
        },
      },
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceManager: true,
    })
    expect(missingStartState.missingStartNode).toBe(true)
    expect(missingStartState.runningStatus).toBe(false)
  })

  it('should require specific access subjects only for the specific access mode', () => {
    expect(isAppAccessConfigured(
      { ...baseAppInfo, access_mode: AccessMode.PUBLIC },
      { groups: [], members: [] },
    )).toBe(true)

    expect(isAppAccessConfigured(
      { ...baseAppInfo, access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS },
      { groups: [], members: [] },
    )).toBe(false)

    expect(isAppAccessConfigured(
      { ...baseAppInfo, access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS },
      { groups: [{ id: 'group-1' }], members: [] },
    )).toBe(true)
  })

  it('should derive operation keys for api and webapp cards', () => {
    expect(getAppCardOperationKeys({
      cardType: 'api',
      appMode: AppModeEnum.COMPLETION,
      isCurrentWorkspaceEditor: true,
    })).toEqual(['develop'])

    expect(getAppCardOperationKeys({
      cardType: 'webapp',
      appMode: AppModeEnum.CHAT,
      isCurrentWorkspaceEditor: false,
    })).toEqual(['launch', 'embedded', 'customize'])
  })
})
