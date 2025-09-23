import { create } from 'zustand'

type UserCursorsState = {
  showUserCursors: boolean
  toggleUserCursors: () => void
}

export const useUserCursorsState = create<UserCursorsState>(set => ({
  showUserCursors: true,
  toggleUserCursors: () => set(state => ({ showUserCursors: !state.showUserCursors })),
}))
