import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement } from 'react'
import type { IconInfo } from '@/models/datasets'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PermissionLevel } from '@/models/permission'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { mockEmojiData } from '@/test/emoji-picker'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import BasicInfoSection from '../basic-info-section'

const mockConsoleState = vi.hoisted(() => ({
  userProfile: {
    id: 'user-1',
    name: 'Current User',
    email: 'current@example.com',
    avatar_url: '',
    role: 'owner',
  },
}))

// Mock app-context

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => mockConsoleState)
})

const render = (ui: ReactElement) => {
  const { wrapper } = createConsoleQueryWrapper({
    systemFeatures: { rbac_enabled: false },
  })
  return renderWithConsoleState(ui, { wrapper })
}

// Mock image uploader hooks for IconPickerDialog
vi.mock('@/app/components/base/image-uploader/hooks', () => ({
  useLocalFileUploader: () => ({
    disabled: false,
    handleLocalFileUpload: vi.fn(),
  }),
  useImageFiles: () => ({
    files: [],
    onUpload: vi.fn(),
    onRemove: vi.fn(),
    onReUpload: vi.fn(),
    onImageLinkLoadError: vi.fn(),
    onImageLinkLoadSuccess: vi.fn(),
    onClear: vi.fn(),
  }),
}))

describe('BasicInfoSection', () => {
  const mockDataset: DatasetDetailWithPartialMembersResponse = createDatasetFixture({
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    permission: PermissionLevel.onlyMe,
    embedding_available: true,
  })

  const mockMemberList: AccountWithRoleResponse[] = [
    {
      id: 'user-1',
      name: 'User 1',
      email: 'user1@example.com',
      role: 'owner',
      roles: [],
      avatar: '',
      avatar_url: '',
      last_login_at: null,
      created_at: null,
      status: 'active',
    },
    {
      id: 'user-2',
      name: 'User 2',
      email: 'user2@example.com',
      role: 'admin',
      roles: [],
      avatar: '',
      avatar_url: '',
      last_login_at: null,
      created_at: null,
      status: 'active',
    },
  ]

  const mockIconInfo: IconInfo = {
    icon_type: 'emoji',
    icon: '📚',
    icon_background: '#FFFFFF',
    icon_url: '',
  }

  const defaultProps = {
    currentDataset: mockDataset,
    name: 'Test Dataset',
    setName: vi.fn(),
    description: 'Test description',
    setDescription: vi.fn(),
    iconInfo: mockIconInfo,
    handleSelectAppIcon: vi.fn(),
    permission: PermissionLevel.onlyMe,
    setPermission: vi.fn(),
    selectedMemberIDs: ['user-1'],
    setSelectedMemberIDs: vi.fn(),
    memberList: mockMemberList,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('names the icon action and opens it with the keyboard', async () => {
      const user = userEvent.setup()
      render(<BasicInfoSection {...defaultProps} />)

      const trigger = screen.getByRole('button', { name: 'datasetSettings.form.changeIcon' })
      await user.tab()
      expect(trigger).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(screen.getByRole('dialog', { name: 'app.iconPicker.title' })).toBeInTheDocument()
    })

    it('associates the permissions field label without losing the selected value', () => {
      render(<BasicInfoSection {...defaultProps} />)

      expect(
        screen.getByRole('button', {
          name: /datasetSettings.form.permissions .*datasetSettings.form.permissionsOnlyMe/,
        }),
      ).toBeInTheDocument()
    })

    it('does not open the icon picker when settings are read-only', async () => {
      const user = userEvent.setup()
      render(<BasicInfoSection {...defaultProps} readonly />)

      const trigger = screen.getByRole('button', { name: 'datasetSettings.form.changeIcon' })
      expect(trigger).toBeDisabled()
      await user.click(trigger)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('Name Input', () => {
    it('should call setName when name input changes', () => {
      const setName = vi.fn()
      render(<BasicInfoSection {...defaultProps} setName={setName} />)

      const nameInput = screen.getByRole('textbox', {
        name: 'datasetSettings.form.name',
      })
      fireEvent.change(nameInput, { target: { value: 'New Name' } })

      expect(setName).toHaveBeenCalledWith('New Name')
    })

    it('should disable name input when embedding is not available', () => {
      const datasetWithoutEmbedding = { ...mockDataset, embedding_available: false }
      render(<BasicInfoSection {...defaultProps} currentDataset={datasetWithoutEmbedding} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      expect(nameInput)!.toBeDisabled()
    })
  })

  describe('Description Textarea', () => {
    it('should call setDescription when description changes', () => {
      const setDescription = vi.fn()
      render(<BasicInfoSection {...defaultProps} setDescription={setDescription} />)

      const descriptionTextarea = screen.getByDisplayValue('Test description')
      fireEvent.change(descriptionTextarea, { target: { value: 'New Description' } })

      expect(setDescription).toHaveBeenCalledWith('New Description')
    })

    it('should disable description textarea when embedding is not available', () => {
      const datasetWithoutEmbedding = { ...mockDataset, embedding_available: false }
      render(<BasicInfoSection {...defaultProps} currentDataset={datasetWithoutEmbedding} />)

      const descriptionTextarea = screen.getByDisplayValue('Test description')
      expect(descriptionTextarea)!.toBeDisabled()
    })
  })

  describe('Permission Selector', () => {
    it('should be disabled when embedding is not available', () => {
      const datasetWithoutEmbedding = { ...mockDataset, embedding_available: false }
      render(<BasicInfoSection {...defaultProps} currentDataset={datasetWithoutEmbedding} />)

      expect(
        screen.getByRole('button', {
          name: /datasetSettings.form.permissions .*datasetSettings.form.permissionsOnlyMe/,
        }),
      ).toBeDisabled()
    })

    it('should be disabled when form is readonly from dataset ACL editability', () => {
      render(<BasicInfoSection {...defaultProps} readonly />)

      expect(
        screen.getByRole('button', {
          name: /datasetSettings.form.permissions .*datasetSettings.form.permissionsOnlyMe/,
        }),
      ).toBeDisabled()
    })

    it('should call setPermission when permission changes', async () => {
      const setPermission = vi.fn()
      render(<BasicInfoSection {...defaultProps} setPermission={setPermission} />)

      const trigger = screen.getByText(/form\.permissionsOnlyMe/i)
      const user = userEvent.setup()
      await user.click(trigger)
      await user.click(await screen.findByText(/form\.permissionsAllMember/i))

      expect(setPermission).toHaveBeenCalledWith(PermissionLevel.allTeamMembers)
    })
  })
})

mockEmojiData()
