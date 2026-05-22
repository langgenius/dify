import { DatasetPermission } from '@/models/datasets'
/**
 * Test suite for permission utility functions
 * Tests dataset edit permission logic based on user roles and dataset settings
 */
import { AppACLPermission, getAppACLCapabilities, hasEditPermissionForDataset, hasPermission } from './permission'

describe('permission', () => {
  /**
   * Tests hasEditPermissionForDataset which checks if a user can edit a dataset
   * Based on three permission levels:
   * - onlyMe: Only the creator can edit
   * - allTeamMembers: All team members can edit
   * - partialMembers: Only specified members can edit
   */
  describe('hasEditPermissionForDataset', () => {
    const userId = 'user-123'
    const creatorId = 'creator-456'
    const otherUserId = 'user-789'

    it('returns true when permission is onlyMe and user is creator', () => {
      const config = {
        createdBy: userId,
        partialMemberList: [],
        permission: DatasetPermission.onlyMe,
      }
      expect(hasEditPermissionForDataset(userId, config)).toBe(true)
    })

    it('returns false when permission is onlyMe and user is not creator', () => {
      const config = {
        createdBy: creatorId,
        partialMemberList: [],
        permission: DatasetPermission.onlyMe,
      }
      expect(hasEditPermissionForDataset(userId, config)).toBe(false)
    })

    it('returns true when permission is allTeamMembers for any user', () => {
      const config = {
        createdBy: creatorId,
        partialMemberList: [],
        permission: DatasetPermission.allTeamMembers,
      }
      expect(hasEditPermissionForDataset(userId, config)).toBe(true)
      expect(hasEditPermissionForDataset(otherUserId, config)).toBe(true)
      expect(hasEditPermissionForDataset(creatorId, config)).toBe(true)
    })

    it('returns true when permission is partialMembers and user is in list', () => {
      const config = {
        createdBy: creatorId,
        partialMemberList: [userId, otherUserId],
        permission: DatasetPermission.partialMembers,
      }
      expect(hasEditPermissionForDataset(userId, config)).toBe(true)
    })

    it('returns false when permission is partialMembers and user is not in list', () => {
      const config = {
        createdBy: creatorId,
        partialMemberList: [otherUserId],
        permission: DatasetPermission.partialMembers,
      }
      expect(hasEditPermissionForDataset(userId, config)).toBe(false)
    })

    it('returns false when permission is partialMembers with empty list', () => {
      const config = {
        createdBy: creatorId,
        partialMemberList: [],
        permission: DatasetPermission.partialMembers,
      }
      expect(hasEditPermissionForDataset(userId, config)).toBe(false)
    })

    it('creator is not automatically granted access with partialMembers permission', () => {
      const config = {
        createdBy: creatorId,
        partialMemberList: [userId],
        permission: DatasetPermission.partialMembers,
      }
      expect(hasEditPermissionForDataset(creatorId, config)).toBe(false)
    })

    it('creator has access when included in partialMemberList', () => {
      const config = {
        createdBy: creatorId,
        partialMemberList: [creatorId, userId],
        permission: DatasetPermission.partialMembers,
      }
      expect(hasEditPermissionForDataset(creatorId, config)).toBe(true)
    })
  })

  describe('hasPermissionKey', () => {
    const permissionKey = 'workspace.member.manage'

    it('returns true when the permission key exists', () => {
      expect(hasPermission(['workspace.member.view', permissionKey], permissionKey)).toBe(true)
    })

    it('returns false when the permission key does not exist', () => {
      expect(hasPermission(['workspace.member.view'], permissionKey)).toBe(false)
    })
  })

  describe('getAppACLCapabilities', () => {
    it('allows test-and-run users to access layout and comment without edit', () => {
      const capabilities = getAppACLCapabilities([AppACLPermission.TestAndRun])

      expect(capabilities.canTestAndRun).toBe(true)
      expect(capabilities.canAccessLayout).toBe(true)
      expect(capabilities.canComment).toBe(true)
      expect(capabilities.canEdit).toBe(false)
    })

    it('allows view-layout users to preview the app but not run/debug', () => {
      const capabilities = getAppACLCapabilities([AppACLPermission.ViewLayout])

      expect(capabilities.canPreviewApp).toBe(true)
      expect(capabilities.canAccessLayout).toBe(true)
      expect(capabilities.canComment).toBe(true)
      expect(capabilities.canTestAndRun).toBe(false)
    })
  })
})
