import type { VersionHistory } from '@/types/workflow'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { WorkflowVersion } from '../../types'
import RestoringTitle from '../restoring-title'

const mockFormatTime = vi.fn()
const mockFormatTimeFromNow = vi.fn()

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: mockFormatTime,
  }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: mockFormatTimeFromNow,
  }),
}))

const createVersion = (overrides: Partial<VersionHistory> = {}): VersionHistory => ({
  id: 'version-1',
  graph: {
    nodes: [],
    edges: [],
  },
  created_at: 1_700_000_000,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  hash: 'hash-1',
  updated_at: 1_700_000_100,
  updated_by: {
    id: 'user-2',
    name: 'Bob',
    email: 'bob@example.com',
  },
  tool_published: false,
  version: 'v1',
  marked_name: 'Release 1',
  marked_comment: '',
  ...overrides,
})

describe('RestoringTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFormatTime.mockReturnValue('09:30:00')
    mockFormatTimeFromNow.mockReturnValue('3 hours ago')
  })

  it('should render draft metadata when the current version is a draft', () => {
    const currentVersion = createVersion({
      version: WorkflowVersion.Draft,
    })

    const { container } = renderWorkflowComponent(<RestoringTitle />, {
      initialStoreState: {
        currentVersion,
      },
    })

    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(currentVersion.updated_at * 1000)
    expect(mockFormatTime).toHaveBeenCalledWith(currentVersion.created_at, 'HH:mm:ss')
    expect(container).toHaveTextContent('workflow.versionHistory.currentDraft')
    expect(container).toHaveTextContent('workflow.common.viewOnly')
    expect(container).toHaveTextContent('workflow.common.unpublished')
    expect(container).toHaveTextContent('3 hours ago 09:30:00')
    expect(container).toHaveTextContent('Alice')
  })

  it('should render published metadata and fallback version name when the marked name is empty', () => {
    const currentVersion = createVersion({
      marked_name: '',
    })

    const { container } = renderWorkflowComponent(<RestoringTitle />, {
      initialStoreState: {
        currentVersion,
      },
    })

    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(currentVersion.created_at * 1000)
    expect(container).toHaveTextContent('workflow.versionHistory.defaultName')
    expect(container).toHaveTextContent('workflow.common.published')
    expect(container).toHaveTextContent('Alice')
  })

  it('should render an empty creator name when the version creator name is missing', () => {
    const currentVersion = createVersion({
      created_by: {
        id: 'user-1',
        name: '',
        email: 'alice@example.com',
      },
    })

    const { container } = renderWorkflowComponent(<RestoringTitle />, {
      initialStoreState: {
        currentVersion,
      },
    })

    expect(container).toHaveTextContent('workflow.common.published')
    expect(container).not.toHaveTextContent('Alice')
  })
})
