/**
 * Generate a consistent color for a user based on their ID
 * Used for cursor colors and avatar backgrounds
 */
export const getUserColor = (id: string): string => {
  const colors = [
    '#155AEF',
    '#026AA2',
    '#444CE7',
    '#7839EE',
    '#3B7C0F',
    '#107569',
    '#C11574',
    '#BC1B06',
    '#D92D20',
    '#E31B54',
    '#B54708',
    '#5D698D',
  ]
  const hash = id.split('').reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0)
    return a & a
  }, 0)
  return colors[Math.abs(hash) % colors.length]!
}
