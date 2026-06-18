import { DatasetPermission } from '@/models/datasets'
/**
 * Test suite for permission utility functions
 * Tests dataset edit permission logic based on user roles and dataset settings
 */
import {
  AppACLPermission,
  DatasetACLPermission,
  getAppACLCapabilities,
  getDatasetACLCapabilities,
  hasEditPermissionForDataset,
  hasPermission,
} from './permission'

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
      expect(hasPermission(['workspace.role.manage', permissionKey], permissionKey)).toBe(true)
    })

    it('returns false when the permission key does not exist', () => {
      expect(hasPermission(['workspace.role.manage'], permissionKey)).toBe(false)
    })
  })

  describe('getAppACLCapabilities', () => {
    it('allows test-and-run users to access layout without edit or comment', () => {
      const capabilities = getAppACLCapabilities([AppACLPermission.TestAndRun])

      expect(capabilities.canTestAndRun).toBe(true)
      expect(capabilities.canAccessLayout).toBe(true)
      expect(capabilities.canComment).toBe(false)
      expect(capabilities.canEdit).toBe(false)
    })

    it('allows view-layout users to preview the app and comment but not run/debug', () => {
      const capabilities = getAppACLCapabilities([AppACLPermission.ViewLayout])

      expect(capabilities.canPreviewApp).toBe(true)
      expect(capabilities.canAccessLayout).toBe(true)
      expect(capabilities.canComment).toBe(true)
      expect(capabilities.canTestAndRun).toBe(false)
    })
  })

  describe('app maintainer capabilities', () => {
    it('grants all app ACL capabilities without injecting app ACL permission keys', () => {
      const permissionKeys: string[] = []
      const capabilities = getAppACLCapabilities(permissionKeys, {
        currentUserId: 'user-1',
        resourceMaintainer: 'user-1',
        workspacePermissionKeys: ['app.create_and_management'],
      })

      expect(capabilities.canViewLayout).toBe(true)
      expect(capabilities.canTestAndRun).toBe(true)
      expect(capabilities.canEdit).toBe(true)
      expect(capabilities.canImportExportDSL).toBe(true)
      expect(capabilities.canDelete).toBe(true)
      expect(capabilities.canReleaseAndVersion).toBe(true)
      expect(capabilities.canMonitor).toBe(true)
      expect(capabilities.canAccessConfig).toBe(true)
      expect(permissionKeys).toEqual([])
    })

    it('keeps app ACL capabilities unchanged when the maintainer lacks app.create_and_management permission', () => {
      const capabilities = getAppACLCapabilities([AppACLPermission.ViewLayout], {
        currentUserId: 'user-1',
        resourceMaintainer: 'user-1',
        workspacePermissionKeys: [],
      })

      expect(capabilities.canViewLayout).toBe(true)
      expect(capabilities.canEdit).toBe(false)
      expect(capabilities.canDelete).toBe(false)
    })
  })

  describe('dataset maintainer capabilities', () => {
    it('grants all dataset ACL capabilities without injecting dataset ACL permission keys', () => {
      const permissionKeys: string[] = []
      const capabilities = getDatasetACLCapabilities(permissionKeys, {
        currentUserId: 'user-1',
        resourceMaintainer: 'user-1',
        workspacePermissionKeys: ['dataset.create_and_management'],
      })

      expect(capabilities.canReadonly).toBe(true)
      expect(capabilities.canEdit).toBe(true)
      expect(capabilities.canImportExportDSL).toBe(true)
      expect(capabilities.canPipelineTest).toBe(true)
      expect(capabilities.canDocumentDownload).toBe(true)
      expect(capabilities.canRetrievalRecall).toBe(true)
      expect(capabilities.canUse).toBe(true)
      expect(capabilities.canDeleteFile).toBe(true)
      expect(capabilities.canPipelineRelease).toBe(true)
      expect(capabilities.canDelete).toBe(true)
      expect(capabilities.canAccessConfig).toBe(true)
      expect(permissionKeys).toEqual([])
    })

    it('keeps dataset ACL capabilities unchanged when the current user is not the maintainer', () => {
      const capabilities = getDatasetACLCapabilities([DatasetACLPermission.Readonly], {
        currentUserId: 'user-1',
        resourceMaintainer: 'user-2',
        workspacePermissionKeys: ['dataset.create_and_management'],
      })

      expect(capabilities.canReadonly).toBe(true)
      expect(capabilities.canEdit).toBe(false)
      expect(capabilities.canDelete).toBe(false)
    })
  })
})
