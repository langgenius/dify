export const demoUsers = {
  alex: { name: 'Alex', color: '#155AEF' },
  sam: { name: 'Sam', color: '#C11574' },
} as const

export type DemoUserId = keyof typeof demoUsers
