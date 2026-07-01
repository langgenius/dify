/**
 * Test suite for permission utility functions
 */
import {
  AppACLPermission,
  DatasetACLPermission,
  getAppACLCapabilities,
  getDatasetACLCapabilities,
  hasOnlyAppPreviewPermission,
  hasOnlyDatasetPreviewPermission,
  hasPermission,
} from './permission'

describe('permission', () => {
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

    it('keeps monitor, tracing config, and log/annotation permissions independent', () => {
      const monitorCapabilities = getAppACLCapabilities([AppACLPermission.Monitor])
      const tracingCapabilities = getAppACLCapabilities([AppACLPermission.TracingConfig])
      const logAndAnnotationCapabilities = getAppACLCapabilities([AppACLPermission.LogAndAnnotation])

      expect(monitorCapabilities.canMonitor).toBe(true)
      expect(monitorCapabilities.canConfigureTracing).toBe(false)
      expect(monitorCapabilities.canAccessLogAndAnnotation).toBe(false)

      expect(tracingCapabilities.canMonitor).toBe(false)
      expect(tracingCapabilities.canConfigureTracing).toBe(true)
      expect(tracingCapabilities.canAccessLogAndAnnotation).toBe(false)

      expect(logAndAnnotationCapabilities.canMonitor).toBe(false)
      expect(logAndAnnotationCapabilities.canConfigureTracing).toBe(false)
      expect(logAndAnnotationCapabilities.canAccessLogAndAnnotation).toBe(true)
    })
  })

  describe('hasOnlyAppPreviewPermission', () => {
    it('should return true when app ACL contains only preview permission', () => {
      expect(hasOnlyAppPreviewPermission([AppACLPermission.Preview])).toBe(true)
    })

    it('should return false when app ACL contains preview permission and another permission', () => {
      expect(hasOnlyAppPreviewPermission([
        AppACLPermission.Preview,
        AppACLPermission.ViewLayout,
      ])).toBe(false)
    })
  })

  describe('hasOnlyDatasetPreviewPermission', () => {
    it('should return true when dataset ACL contains only preview permission', () => {
      expect(hasOnlyDatasetPreviewPermission([DatasetACLPermission.Preview])).toBe(true)
    })

    it('should return false when dataset ACL contains preview permission and another permission', () => {
      expect(hasOnlyDatasetPreviewPermission([
        DatasetACLPermission.Preview,
        DatasetACLPermission.Readonly,
      ])).toBe(false)
    })
  })

  describe('app maintainer capabilities', () => {
    it('grants all app ACL capabilities without injecting app ACL permission keys', () => {
      const permissionKeys: string[] = []
      const capabilities = getAppACLCapabilities(permissionKeys, {
        currentUserId: 'user-1',
        resourceMaintainer: 'user-1',
        workspacePermissionKeys: ['app.create_and_management'],
        isRbacEnabled: true,
      })

      expect(capabilities.canViewLayout).toBe(true)
      expect(capabilities.canTestAndRun).toBe(true)
      expect(capabilities.canEdit).toBe(true)
      expect(capabilities.canImportExportDSL).toBe(true)
      expect(capabilities.canDelete).toBe(true)
      expect(capabilities.canReleaseAndVersion).toBe(true)
      expect(capabilities.canMonitor).toBe(true)
      expect(capabilities.canConfigureTracing).toBe(true)
      expect(capabilities.canAccessLogAndAnnotation).toBe(true)
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

    it('does not grant app access config when RBAC is disabled', () => {
      const capabilities = getAppACLCapabilities([AppACLPermission.AccessConfig], {
        isRbacEnabled: false,
      })

      expect(capabilities.canAccessConfig).toBe(false)
    })
  })

  describe('dataset maintainer capabilities', () => {
    it('grants all dataset ACL capabilities without injecting dataset ACL permission keys', () => {
      const permissionKeys: string[] = []
      const capabilities = getDatasetACLCapabilities(permissionKeys, {
        currentUserId: 'user-1',
        resourceMaintainer: 'user-1',
        workspacePermissionKeys: ['dataset.create_and_management'],
        isRbacEnabled: true,
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

    it('does not grant dataset access config when RBAC is disabled', () => {
      const capabilities = getDatasetACLCapabilities([DatasetACLPermission.AccessConfig], {
        isRbacEnabled: false,
      })

      expect(capabilities.canAccessConfig).toBe(false)
    })
  })
})
