import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import {
  getAppCardDisplayState,
  getAppCardOperationKeys,
  hasWorkflowStartNode,
  isAppAccessConfigured,
} from '../app-card-utils'

describe('app-card-utils', () => {
  const baseAppInfo = {
    id: 'app-1',
    mode: AppModeEnum.WORKFLOW,
    enable_site: true,
    enable_api: true,
    site: {
      app_base_url: 'https://example.com',
      access_token: 'token-1',
    },
    access_mode: AccessMode.PUBLIC,
  } as AppDetailResponse & Partial<AppSSO>

  describe('hasWorkflowStartNode', () => {
    it('should detect a workflow start node', () => {
      expect(hasWorkflowStartNode({
        graph: {
          nodes: [
            { data: { type: 'llm' } },
            { data: { type: 'start' } },
          ],
        },
      })).toBe(true)
    })

    it('should return false when the workflow has no start node', () => {
      expect(hasWorkflowStartNode({
        graph: {
          nodes: [{ data: { type: 'llm' } }],
        },
      })).toBe(false)
    })
  })

  describe('getAppCardDisplayState', () => {
    it('should disable unpublished workflow apps and mark them as minimal state', () => {
      const state = getAppCardDisplayState({
        appInfo: baseAppInfo,
        cardType: 'webapp',
        currentWorkflow: null,
        isCurrentWorkspaceEditor: true,
        isCurrentWorkspaceManager: true,
      })

      expect(state.appUnpublished).toBe(true)
      expect(state.missingStartNode).toBe(true)
      expect(state.toggleDisabled).toBe(true)
      expect(state.isMinimalState).toBe(true)
      expect(state.runningStatus).toBe(false)
    })

    it('should keep published workflow apps enabled when the user has permissions', () => {
      const state = getAppCardDisplayState({
        appInfo: baseAppInfo,
        cardType: 'webapp',
        currentWorkflow: {
          graph: {
            nodes: [{ data: { type: 'start' } }],
          },
        },
        isCurrentWorkspaceEditor: true,
        isCurrentWorkspaceManager: true,
      })

      expect(state.appUnpublished).toBe(false)
      expect(state.missingStartNode).toBe(false)
      expect(state.toggleDisabled).toBe(false)
      expect(state.isMinimalState).toBe(false)
      expect(state.accessibleUrl).toBe(`https://example.com${basePath}/workflow/token-1`)
    })
  })

  describe('getAppCardOperationKeys', () => {
    it('should include embedded and settings actions for editable chat webapps', () => {
      expect(getAppCardOperationKeys({
        cardType: 'webapp',
        appMode: AppModeEnum.CHAT,
        isCurrentWorkspaceEditor: true,
      })).toEqual(['launch', 'embedded', 'customize', 'settings'])
    })

    it('should only expose the develop action for api cards', () => {
      expect(getAppCardOperationKeys({
        cardType: 'api',
        appMode: AppModeEnum.COMPLETION,
        isCurrentWorkspaceEditor: false,
      })).toEqual(['develop'])
    })
  })

  describe('isAppAccessConfigured', () => {
    it('should require members or groups for specific access mode', () => {
      expect(isAppAccessConfigured(
        {
          id: 'app-1',
          access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
        } as unknown as AppDetailResponse,
        { groups: [], members: [] },
      )).toBe(false)
    })

    it('should treat non-specific access modes as configured', () => {
      expect(isAppAccessConfigured(
        {
          id: 'app-1',
          access_mode: AccessMode.PUBLIC,
        } as unknown as AppDetailResponse,
        { groups: [], members: [] },
      )).toBe(true)
    })
  })
})
