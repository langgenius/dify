import { renderHook } from '@testing-library/react'
import { useSkillCodeCursors } from '../remote-cursors'

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

describe('useSkillCodeCursors', () => {
  it('should return a null overlay when the hook is disabled', () => {
    const { result } = renderHook(() => useSkillCodeCursors({
      editor: null,
      fileId: 'file-1',
      enabled: false,
    }))

    expect(result.current.overlay).toBeNull()
  })
})
