/**
 * Collaborator colors from the design, in design order. They are the
 * `components/icon/bg/*-solid` tokens as fixed hex values, so the same user
 * keeps the same color in both themes.
 */
export const COLLABORATOR_COLORS = [
  '#155AEF',
  '#0BA5EC',
  '#444CE7',
  '#7839EE',
  '#4CA30D',
  '#0E9384',
  '#DD2590',
  '#FF4405',
  '#D92D20',
  '#E31B54',
  '#F79009',
  '#828DAD',
] as const

/**
 * A stable collaborator color for a user ID, shared by cursors, avatars and
 * the node editing frame.
 */
export const getUserColor = (id: string): string => {
  const hash = id.split('').reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0)
    return a & a
  }, 0)
  return COLLABORATOR_COLORS[Math.abs(hash) % COLLABORATOR_COLORS.length]!
}
