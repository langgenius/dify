import { render } from '@testing-library/react'
import { LocalCursorPlugin, SkillRemoteCursors } from '../index'

const mockEditor = {
  registerCommand: vi.fn(),
  registerUpdateListener: vi.fn(),
  getRootElement: vi.fn(() => null),
  getEditorState: vi.fn(() => ({
    read: (reader: () => unknown) => reader(),
  })),
}

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      id: 'user-1',
    },
  }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onOnlineUsersUpdate: () => vi.fn(),
  },
}))

vi.mock('@/app/components/workflow/collaboration/skills/skill-collaboration-manager', () => ({
  skillCollaborationManager: {
    onCursorUpdate: () => vi.fn(),
    emitCursorUpdate: vi.fn(),
  },
}))

describe('skill editor remote cursors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not register local cursor listeners when collaboration is disabled', () => {
    const { container } = render(<LocalCursorPlugin fileId="file-1" enabled={false} />)

    expect(container).toBeEmptyDOMElement()
    expect(mockEditor.registerCommand).not.toHaveBeenCalled()
    expect(mockEditor.registerUpdateListener).not.toHaveBeenCalled()
  })

  it('should render no overlay when remote cursors are disabled', () => {
    const { container } = render(<SkillRemoteCursors fileId="file-1" enabled={false} />)

    expect(container).toBeEmptyDOMElement()
  })
})
