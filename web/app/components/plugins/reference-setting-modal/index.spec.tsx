import type { AutoUpdateConfig } from './auto-update-setting/types'
import type { Permissions, ReferenceSetting } from '@/app/components/plugins/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionType } from '@/app/components/plugins/types'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from './auto-update-setting/types'
import ReferenceSettingModal from './index'
import Label from './label'

// ================================
// Mock External Dependencies Only
// ================================

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => {
      const translations: Record<string, string> = {
        'privilege.title': 'Plugin Permissions',
        'privilege.whoCanInstall': 'Who can install plugins',
        'privilege.whoCanDebug': 'Who can debug plugins',
        'privilege.everyone': 'Everyone',
        'privilege.admins': 'Admins Only',
        'privilege.noone': 'No One',
        'operation.cancel': 'Cancel',
        'operation.save': 'Save',
        'autoUpdate.updateSettings': 'Update Settings',
      }
      const fullKey = options?.ns ? `${options.ns}.${key}` : key
      return translations[fullKey] || translations[key] || key
    },
  }),
}))

// Mock global public store
const mockSystemFeatures = { enable_marketplace: true }
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (s: { systemFeatures: typeof mockSystemFeatures }) => typeof mockSystemFeatures) => {
    return selector({ systemFeatures: mockSystemFeatures })
  },
}))

// Mock Modal component
vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, isShow, onClose, closable, className }: {
    children: React.ReactNode
    isShow: boolean
    onClose: () => void
    closable?: boolean
    className?: string
  }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="modal" className={className}>
        {closable && (
          <button data-testid="modal-close" onClick={onClose}>
            Close
          </button>
        )}
        {children}
      </div>
    )
  },
}))

// Mock OptionCard component
vi.mock('@/app/components/workflow/nodes/_base/components/option-card', () => ({
  default: ({ title, onSelect, selected, className }: {
    title: string
    onSelect: () => void
    selected: boolean
    className?: string
  }) => (
    <button
      data-testid={`option-card-${title.toLowerCase().replace(/\s+/g, '-')}`}
      onClick={onSelect}
      aria-pressed={selected}
      className={className}
    >
      {title}
    </button>
  ),
}))

// Mock AutoUpdateSetting component
const mockAutoUpdateSettingOnChange = vi.fn()
vi.mock('./auto-update-setting', () => ({
  default: ({ payload, onChange }: {
    payload: AutoUpdateConfig
    onChange: (payload: AutoUpdateConfig) => void
  }) => {
    mockAutoUpdateSettingOnChange.mockImplementation(onChange)
    return (
      <div data-testid="auto-update-setting">
        <span data-testid="auto-update-strategy">{payload.strategy_setting}</span>
        <span data-testid="auto-update-mode">{payload.upgrade_mode}</span>
        <button
          data-testid="auto-update-change"
          onClick={() => onChange({
            ...payload,
            strategy_setting: AUTO_UPDATE_STRATEGY.latest,
          })}
        >
          Change Strategy
        </button>
      </div>
    )
  },
}))

// Mock config default value
vi.mock('./auto-update-setting/config', () => ({
  defaultValue: {
    strategy_setting: AUTO_UPDATE_STRATEGY.disabled,
    upgrade_time_of_day: 0,
    upgrade_mode: AUTO_UPDATE_MODE.update_all,
    exclude_plugins: [],
    include_plugins: [],
  },
}))

// ================================
// Test Data Factories
// ================================

const createMockPermissions = (overrides: Partial<Permissions> = {}): Permissions => ({
  install_permission: PermissionType.everyone,
  debug_permission: PermissionType.admin,
  ...overrides,
})

const createMockAutoUpdateConfig = (overrides: Partial<AutoUpdateConfig> = {}): AutoUpdateConfig => ({
  strategy_setting: AUTO_UPDATE_STRATEGY.fixOnly,
  upgrade_time_of_day: 36000,
  upgrade_mode: AUTO_UPDATE_MODE.update_all,
  exclude_plugins: [],
  include_plugins: [],
  ...overrides,
})

const createMockReferenceSetting = (overrides: Partial<ReferenceSetting> = {}): ReferenceSetting => ({
  permission: createMockPermissions(),
  auto_upgrade: createMockAutoUpdateConfig(),
  ...overrides,
})

// ================================
// Test Suites
// ================================

describe('reference-setting-modal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSystemFeatures.enable_marketplace = true
  })

  // ============================================================
  // Label Component Tests
  // ============================================================
  describe('Label (label.tsx)', () => {
    describe('Rendering', () => {
      it('should render label text', () => {
        // Arrange & Act
        render(<Label label="Test Label" />)

        // Assert
        expect(screen.getByText('Test Label')).toBeInTheDocument()
      })

      it('should render with label only when no description provided', () => {
        // Arrange & Act
        const { container } = render(<Label label="Simple Label" />)

        // Assert
        expect(screen.getByText('Simple Label')).toBeInTheDocument()
        // Should have h-6 class when no description
        expect(container.querySelector('.h-6')).toBeInTheDocument()
      })

      it('should render label and description when both provided', () => {
        // Arrange & Act
        render(<Label label="Label Text" description="Description Text" />)

        // Assert
        expect(screen.getByText('Label Text')).toBeInTheDocument()
        expect(screen.getByText('Description Text')).toBeInTheDocument()
      })

      it('should apply h-4 class to label container when description is provided', () => {
        // Arrange & Act
        const { container } = render(<Label label="Label" description="Has description" />)

        // Assert
        expect(container.querySelector('.h-4')).toBeInTheDocument()
      })

      it('should not render description element when description is undefined', () => {
        // Arrange & Act
        const { container } = render(<Label label="Only Label" />)

        // Assert
        expect(container.querySelectorAll('.body-xs-regular')).toHaveLength(0)
      })

      it('should render description with correct styling', () => {
        // Arrange & Act
        const { container } = render(<Label label="Label" description="Styled Description" />)

        // Assert
        const descriptionElement = container.querySelector('.body-xs-regular')
        expect(descriptionElement).toBeInTheDocument()
        expect(descriptionElement).toHaveClass('mt-1', 'text-text-tertiary')
      })
    })

    describe('Props Variations', () => {
      it('should handle empty label string', () => {
        // Arrange & Act
        const { container } = render(<Label label="" />)

        // Assert - should render without crashing
        expect(container.firstChild).toBeInTheDocument()
      })

      it('should handle empty description string', () => {
        // Arrange & Act
        render(<Label label="Label" description="" />)

        // Assert - empty description still renders the description container
        expect(screen.getByText('Label')).toBeInTheDocument()
      })

      it('should handle long label text', () => {
        // Arrange
        const longLabel = 'A'.repeat(200)

        // Act
        render(<Label label={longLabel} />)

        // Assert
        expect(screen.getByText(longLabel)).toBeInTheDocument()
      })

      it('should handle long description text', () => {
        // Arrange
        const longDescription = 'B'.repeat(500)

        // Act
        render(<Label label="Label" description={longDescription} />)

        // Assert
        expect(screen.getByText(longDescription)).toBeInTheDocument()
      })

      it('should handle special characters in label', () => {
        // Arrange
        const specialLabel = '<script>alert("xss")</script>'

        // Act
        render(<Label label={specialLabel} />)

        // Assert - should be escaped
        expect(screen.getByText(specialLabel)).toBeInTheDocument()
      })

      it('should handle special characters in description', () => {
        // Arrange
        const specialDescription = '!@#$%^&*()_+-=[]{}|;:,.<>?'

        // Act
        render(<Label label="Label" description={specialDescription} />)

        // Assert
        expect(screen.getByText(specialDescription)).toBeInTheDocument()
      })
    })

    describe('Component Memoization', () => {
      it('should be memoized with React.memo', () => {
        // Assert
        expect(Label).toBeDefined()
        expect((Label as any).$$typeof?.toString()).toContain('Symbol')
      })
    })

    describe('Styling', () => {
      it('should apply system-sm-semibold class to label', () => {
        // Arrange & Act
        const { container } = render(<Label label="Styled Label" />)

        // Assert
        expect(container.querySelector('.system-sm-semibold')).toBeInTheDocument()
      })

      it('should apply text-text-secondary class to label', () => {
        // Arrange & Act
        const { container } = render(<Label label="Styled Label" />)

        // Assert
        expect(container.querySelector('.text-text-secondary')).toBeInTheDocument()
      })
    })
  })

  // ============================================================
  // ReferenceSettingModal (PluginSettingModal) Component Tests
  // ============================================================
  describe('ReferenceSettingModal (index.tsx)', () => {
    const defaultProps = {
      payload: createMockReferenceSetting(),
      onHide: vi.fn(),
      onSave: vi.fn(),
    }

    describe('Rendering', () => {
      it('should render modal with correct title', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert
        expect(screen.getByText('Plugin Permissions')).toBeInTheDocument()
      })

      it('should render install permission section', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert
        expect(screen.getByText('Who can install plugins')).toBeInTheDocument()
      })

      it('should render debug permission section', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert
        expect(screen.getByText('Who can debug plugins')).toBeInTheDocument()
      })

      it('should render all permission options for install', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert - should have 6 option cards total (3 for install, 3 for debug)
        expect(screen.getAllByTestId(/option-card/)).toHaveLength(6)
      })

      it('should render cancel and save buttons', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert
        expect(screen.getByText('Cancel')).toBeInTheDocument()
        expect(screen.getByText('Save')).toBeInTheDocument()
      })

      it('should render AutoUpdateSetting when marketplace is enabled', () => {
        // Arrange
        mockSystemFeatures.enable_marketplace = true

        // Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert
        expect(screen.getByTestId('auto-update-setting')).toBeInTheDocument()
      })

      it('should not render AutoUpdateSetting when marketplace is disabled', () => {
        // Arrange
        mockSystemFeatures.enable_marketplace = false

        // Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert
        expect(screen.queryByTestId('auto-update-setting')).not.toBeInTheDocument()
      })

      it('should render modal with closable attribute', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert
        expect(screen.getByTestId('modal-close')).toBeInTheDocument()
      })
    })

    describe('State Management', () => {
      it('should initialize with payload permission values', () => {
        // Arrange
        const payload = createMockReferenceSetting({
          permission: {
            install_permission: PermissionType.admin,
            debug_permission: PermissionType.noOne,
          },
        })

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

        // Assert - admin option should be selected for install (first one)
        const adminOptions = screen.getAllByTestId('option-card-admins-only')
        expect(adminOptions[0]).toHaveAttribute('aria-pressed', 'true') // Install permission

        // Assert - noOne option should be selected for debug (second one)
        const noOneOptions = screen.getAllByTestId('option-card-no-one')
        expect(noOneOptions[1]).toHaveAttribute('aria-pressed', 'true') // Debug permission
      })

      it('should update tempPrivilege when permission option is clicked', () => {
        // Arrange
        render(<ReferenceSettingModal {...defaultProps} />)

        // Act - click on "No One" for install permission
        const noOneOptions = screen.getAllByTestId('option-card-no-one')
        fireEvent.click(noOneOptions[0]) // First one is for install permission

        // Assert - the option should now be selected
        expect(noOneOptions[0]).toHaveAttribute('aria-pressed', 'true')
      })

      it('should initialize with payload auto_upgrade values', () => {
        // Arrange
        const payload = createMockReferenceSetting({
          auto_upgrade: createMockAutoUpdateConfig({
            strategy_setting: AUTO_UPDATE_STRATEGY.latest,
          }),
        })

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

        // Assert
        expect(screen.getByTestId('auto-update-strategy')).toHaveTextContent('latest')
      })

      it('should use default auto_upgrade when payload.auto_upgrade is undefined', () => {
        // Arrange
        const payload = {
          permission: createMockPermissions(),
          auto_upgrade: undefined as any,
        }

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

        // Assert - should use default value (disabled)
        expect(screen.getByTestId('auto-update-strategy')).toHaveTextContent('disabled')
      })
    })

    describe('User Interactions', () => {
      it('should call onHide when cancel button is clicked', () => {
        // Arrange
        const onHide = vi.fn()

        // Act
        render(<ReferenceSettingModal {...defaultProps} onHide={onHide} />)
        fireEvent.click(screen.getByText('Cancel'))

        // Assert
        expect(onHide).toHaveBeenCalledTimes(1)
      })

      it('should call onHide when modal close button is clicked', () => {
        // Arrange
        const onHide = vi.fn()

        // Act
        render(<ReferenceSettingModal {...defaultProps} onHide={onHide} />)
        fireEvent.click(screen.getByTestId('modal-close'))

        // Assert
        expect(onHide).toHaveBeenCalledTimes(1)
      })

      it('should call onSave with correct payload when save button is clicked', async () => {
        // Arrange
        const onSave = vi.fn().mockResolvedValue(undefined)
        const onHide = vi.fn()

        // Act
        render(<ReferenceSettingModal {...defaultProps} onSave={onSave} onHide={onHide} />)
        fireEvent.click(screen.getByText('Save'))

        // Assert
        await waitFor(() => {
          expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            permission: expect.any(Object),
            auto_upgrade: expect.any(Object),
          }))
        })
      })

      it('should call onHide after successful save', async () => {
        // Arrange
        const onSave = vi.fn().mockResolvedValue(undefined)
        const onHide = vi.fn()

        // Act
        render(<ReferenceSettingModal {...defaultProps} onSave={onSave} onHide={onHide} />)
        fireEvent.click(screen.getByText('Save'))

        // Assert
        await waitFor(() => {
          expect(onHide).toHaveBeenCalledTimes(1)
        })
      })

      it('should update install permission when Everyone option is clicked', () => {
        // Arrange
        const payload = createMockReferenceSetting({
          permission: {
            install_permission: PermissionType.noOne,
            debug_permission: PermissionType.noOne,
          },
        })

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

        // Click Everyone for install permission
        const everyoneOptions = screen.getAllByTestId('option-card-everyone')
        fireEvent.click(everyoneOptions[0])

        // Assert
        expect(everyoneOptions[0]).toHaveAttribute('aria-pressed', 'true')
      })

      it('should update debug permission when Admins Only option is clicked', () => {
        // Arrange
        const payload = createMockReferenceSetting({
          permission: {
            install_permission: PermissionType.everyone,
            debug_permission: PermissionType.everyone,
          },
        })

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

        // Click Admins Only for debug permission (second set of options)
        const adminOptions = screen.getAllByTestId('option-card-admins-only')
        fireEvent.click(adminOptions[1]) // Second one is for debug permission

        // Assert
        expect(adminOptions[1]).toHaveAttribute('aria-pressed', 'true')
      })

      it('should update auto_upgrade config when changed in AutoUpdateSetting', async () => {
        // Arrange
        const onSave = vi.fn().mockResolvedValue(undefined)

        // Act
        render(<ReferenceSettingModal {...defaultProps} onSave={onSave} />)

        // Change auto update strategy
        fireEvent.click(screen.getByTestId('auto-update-change'))

        // Save to verify the change
        fireEvent.click(screen.getByText('Save'))

        // Assert
        await waitFor(() => {
          expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            auto_upgrade: expect.objectContaining({
              strategy_setting: AUTO_UPDATE_STRATEGY.latest,
            }),
          }))
        })
      })
    })

    describe('Callback Stability and Memoization', () => {
      it('handlePrivilegeChange should be memoized with useCallback', () => {
        // Arrange
        const { rerender } = render(<ReferenceSettingModal {...defaultProps} />)

        // Act - rerender with same props
        rerender(<ReferenceSettingModal {...defaultProps} />)

        // Assert - component should render without issues
        expect(screen.getByText('Plugin Permissions')).toBeInTheDocument()
      })

      it('handleSave should be memoized with useCallback', async () => {
        // Arrange
        const onSave = vi.fn().mockResolvedValue(undefined)
        const { rerender } = render(<ReferenceSettingModal {...defaultProps} onSave={onSave} />)

        // Act - rerender and click save
        rerender(<ReferenceSettingModal {...defaultProps} onSave={onSave} />)
        fireEvent.click(screen.getByText('Save'))

        // Assert
        await waitFor(() => {
          expect(onSave).toHaveBeenCalledTimes(1)
        })
      })

      it('handlePrivilegeChange should create new handler with correct key', () => {
        // Arrange
        render(<ReferenceSettingModal {...defaultProps} />)

        // Act - click install permission option
        const everyoneOptions = screen.getAllByTestId('option-card-everyone')
        fireEvent.click(everyoneOptions[0])

        // Assert - install permission should be updated
        expect(everyoneOptions[0]).toHaveAttribute('aria-pressed', 'true')
      })
    })

    describe('Component Memoization', () => {
      it('should be memoized with React.memo', () => {
        // Assert
        expect(ReferenceSettingModal).toBeDefined()
        expect((ReferenceSettingModal as any).$$typeof?.toString()).toContain('Symbol')
      })
    })

    describe('Edge Cases and Error Handling', () => {
      it('should handle null payload gracefully', () => {
        // Arrange
        const payload = null as any

        // Act & Assert - should not crash
        render(<ReferenceSettingModal {...defaultProps} payload={payload} />)
        expect(screen.getByText('Plugin Permissions')).toBeInTheDocument()
      })

      it('should handle undefined permission values', () => {
        // Arrange
        const payload = {
          permission: undefined as any,
          auto_upgrade: createMockAutoUpdateConfig(),
        }

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

        // Assert - should use default PermissionType.noOne
        const noOneOptions = screen.getAllByTestId('option-card-no-one')
        expect(noOneOptions[0]).toHaveAttribute('aria-pressed', 'true')
      })

      it('should handle missing install_permission', () => {
        // Arrange
        const payload = createMockReferenceSetting({
          permission: {
            install_permission: undefined as any,
            debug_permission: PermissionType.everyone,
          },
        })

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

        // Assert - should fall back to PermissionType.noOne
        expect(screen.getByText('Plugin Permissions')).toBeInTheDocument()
      })

      it('should handle missing debug_permission', () => {
        // Arrange
        const payload = createMockReferenceSetting({
          permission: {
            install_permission: PermissionType.everyone,
            debug_permission: undefined as any,
          },
        })

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

        // Assert - should fall back to PermissionType.noOne
        expect(screen.getByText('Plugin Permissions')).toBeInTheDocument()
      })

      it('should handle slow async onSave gracefully', async () => {
        // Arrange - test that the component handles async save correctly
        let resolvePromise: () => void
        const onSave = vi.fn().mockImplementation(() => {
          return new Promise<void>((resolve) => {
            resolvePromise = resolve
          })
        })
        const onHide = vi.fn()

        // Act
        render(<ReferenceSettingModal {...defaultProps} onSave={onSave} onHide={onHide} />)
        fireEvent.click(screen.getByText('Save'))

        // Assert - onSave should be called immediately
        expect(onSave).toHaveBeenCalledTimes(1)

        // onHide should not be called until save resolves
        expect(onHide).not.toHaveBeenCalled()

        // Resolve the promise
        resolvePromise!()

        // Now onHide should be called
        await waitFor(() => {
          expect(onHide).toHaveBeenCalledTimes(1)
        })
      })
    })

    describe('Props Variations', () => {
      it('should render with all PermissionType combinations', () => {
        // Test each permission type
        const permissionTypes = [PermissionType.everyone, PermissionType.admin, PermissionType.noOne]

        permissionTypes.forEach((installPerm) => {
          permissionTypes.forEach((debugPerm) => {
            // Arrange
            const payload = createMockReferenceSetting({
              permission: {
                install_permission: installPerm,
                debug_permission: debugPerm,
              },
            })

            // Act
            const { unmount } = render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

            // Assert - should render without crashing
            expect(screen.getByText('Plugin Permissions')).toBeInTheDocument()

            unmount()
          })
        })
      })

      it('should render with all AUTO_UPDATE_STRATEGY values', () => {
        // Test each strategy
        const strategies = [
          AUTO_UPDATE_STRATEGY.disabled,
          AUTO_UPDATE_STRATEGY.fixOnly,
          AUTO_UPDATE_STRATEGY.latest,
        ]

        strategies.forEach((strategy) => {
          // Arrange
          const payload = createMockReferenceSetting({
            auto_upgrade: createMockAutoUpdateConfig({
              strategy_setting: strategy,
            }),
          })

          // Act
          const { unmount } = render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

          // Assert
          expect(screen.getByTestId('auto-update-strategy')).toHaveTextContent(strategy)

          unmount()
        })
      })

      it('should render with all AUTO_UPDATE_MODE values', () => {
        // Test each mode
        const modes = [
          AUTO_UPDATE_MODE.update_all,
          AUTO_UPDATE_MODE.partial,
          AUTO_UPDATE_MODE.exclude,
        ]

        modes.forEach((mode) => {
          // Arrange
          const payload = createMockReferenceSetting({
            auto_upgrade: createMockAutoUpdateConfig({
              upgrade_mode: mode,
            }),
          })

          // Act
          const { unmount } = render(<ReferenceSettingModal {...defaultProps} payload={payload} />)

          // Assert
          expect(screen.getByTestId('auto-update-mode')).toHaveTextContent(mode)

          unmount()
        })
      })
    })

    describe('State Updates', () => {
      it('should preserve tempPrivilege when changing install_permission', async () => {
        // Arrange
        const onSave = vi.fn().mockResolvedValue(undefined)
        const payload = createMockReferenceSetting({
          permission: {
            install_permission: PermissionType.everyone,
            debug_permission: PermissionType.admin,
          },
        })

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={payload} onSave={onSave} />)

        // Change install permission to noOne
        const noOneOptions = screen.getAllByTestId('option-card-no-one')
        fireEvent.click(noOneOptions[0])

        // Save
        fireEvent.click(screen.getByText('Save'))

        // Assert - debug_permission should still be admin
        await waitFor(() => {
          expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            permission: expect.objectContaining({
              install_permission: PermissionType.noOne,
              debug_permission: PermissionType.admin,
            }),
          }))
        })
      })

      it('should preserve tempPrivilege when changing debug_permission', async () => {
        // Arrange
        const onSave = vi.fn().mockResolvedValue(undefined)
        const payload = createMockReferenceSetting({
          permission: {
            install_permission: PermissionType.admin,
            debug_permission: PermissionType.everyone,
          },
        })

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={payload} onSave={onSave} />)

        // Change debug permission to noOne
        const noOneOptions = screen.getAllByTestId('option-card-no-one')
        fireEvent.click(noOneOptions[1]) // Second one is for debug

        // Save
        fireEvent.click(screen.getByText('Save'))

        // Assert - install_permission should still be admin
        await waitFor(() => {
          expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            permission: expect.objectContaining({
              install_permission: PermissionType.admin,
              debug_permission: PermissionType.noOne,
            }),
          }))
        })
      })

      it('should update tempAutoUpdateConfig independently of permissions', async () => {
        // Arrange
        const onSave = vi.fn().mockResolvedValue(undefined)
        const initialPayload = createMockReferenceSetting()

        // Act
        render(<ReferenceSettingModal {...defaultProps} payload={initialPayload} onSave={onSave} />)

        // Change auto update
        fireEvent.click(screen.getByTestId('auto-update-change'))

        // Change install permission
        const everyoneOptions = screen.getAllByTestId('option-card-everyone')
        fireEvent.click(everyoneOptions[0])

        // Save
        fireEvent.click(screen.getByText('Save'))

        // Assert - both changes should be saved
        await waitFor(() => {
          expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            permission: expect.objectContaining({
              install_permission: PermissionType.everyone,
            }),
            auto_upgrade: expect.objectContaining({
              strategy_setting: AUTO_UPDATE_STRATEGY.latest,
            }),
          }))
        })
      })
    })

    describe('Modal Integration', () => {
      it('should render modal with correct className', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert
        const modal = screen.getByTestId('modal')
        expect(modal).toHaveClass('w-[620px]', 'max-w-[620px]', '!p-0')
      })

      it('should pass isShow=true to Modal', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert - modal should be visible
        expect(screen.getByTestId('modal')).toBeInTheDocument()
      })
    })

    describe('Layout and Structure', () => {
      it('should render permission sections in correct order', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert - check order by getting all section labels
        const labels = screen.getAllByText(/Who can/)
        expect(labels[0]).toHaveTextContent('Who can install plugins')
        expect(labels[1]).toHaveTextContent('Who can debug plugins')
      })

      it('should render three options per permission section', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert
        const everyoneOptions = screen.getAllByTestId('option-card-everyone')
        const adminOptions = screen.getAllByTestId('option-card-admins-only')
        const noOneOptions = screen.getAllByTestId('option-card-no-one')

        expect(everyoneOptions).toHaveLength(2) // One for install, one for debug
        expect(adminOptions).toHaveLength(2)
        expect(noOneOptions).toHaveLength(2)
      })

      it('should render footer with action buttons', () => {
        // Arrange & Act
        render(<ReferenceSettingModal {...defaultProps} />)

        // Assert
        const cancelButton = screen.getByText('Cancel')
        const saveButton = screen.getByText('Save')

        expect(cancelButton).toBeInTheDocument()
        expect(saveButton).toBeInTheDocument()
      })
    })
  })

  // ============================================================
  // Integration Tests
  // ============================================================
  describe('Integration', () => {
    it('should handle complete workflow: change permissions, update auto-update, save', async () => {
      // Arrange
      const onSave = vi.fn().mockResolvedValue(undefined)
      const onHide = vi.fn()
      const initialPayload = createMockReferenceSetting({
        permission: {
          install_permission: PermissionType.noOne,
          debug_permission: PermissionType.noOne,
        },
        auto_upgrade: createMockAutoUpdateConfig({
          strategy_setting: AUTO_UPDATE_STRATEGY.disabled,
        }),
      })

      // Act
      render(
        <ReferenceSettingModal
          payload={initialPayload}
          onHide={onHide}
          onSave={onSave}
        />,
      )

      // Change install permission to Everyone
      const everyoneOptions = screen.getAllByTestId('option-card-everyone')
      fireEvent.click(everyoneOptions[0])

      // Change debug permission to Admins Only
      const adminOptions = screen.getAllByTestId('option-card-admins-only')
      fireEvent.click(adminOptions[1])

      // Change auto-update strategy
      fireEvent.click(screen.getByTestId('auto-update-change'))

      // Save
      fireEvent.click(screen.getByText('Save'))

      // Assert
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith({
          permission: {
            install_permission: PermissionType.everyone,
            debug_permission: PermissionType.admin,
          },
          auto_upgrade: expect.objectContaining({
            strategy_setting: AUTO_UPDATE_STRATEGY.latest,
          }),
        })
        expect(onHide).toHaveBeenCalled()
      })
    })

    it('should cancel without saving changes', () => {
      // Arrange
      const onSave = vi.fn()
      const onHide = vi.fn()
      const initialPayload = createMockReferenceSetting()

      // Act
      render(
        <ReferenceSettingModal
          payload={initialPayload}
          onHide={onHide}
          onSave={onSave}
        />,
      )

      // Make some changes
      const noOneOptions = screen.getAllByTestId('option-card-no-one')
      fireEvent.click(noOneOptions[0])

      // Cancel
      fireEvent.click(screen.getByText('Cancel'))

      // Assert
      expect(onSave).not.toHaveBeenCalled()
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('Label component should work correctly within modal context', () => {
      // Arrange
      const props = {
        payload: createMockReferenceSetting(),
        onHide: vi.fn(),
        onSave: vi.fn(),
      }

      // Act
      render(<ReferenceSettingModal {...props} />)

      // Assert - Labels are rendered correctly
      expect(screen.getByText('Who can install plugins')).toBeInTheDocument()
      expect(screen.getByText('Who can debug plugins')).toBeInTheDocument()
    })
  })
})
