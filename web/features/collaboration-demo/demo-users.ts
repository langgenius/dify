export const demoUsers = {
  alex: { name: 'Alex', color: '#155AEF' },
  sam: { name: 'Sam', color: '#DD2590' },
} as const

export type DemoUserId = keyof typeof demoUsers
