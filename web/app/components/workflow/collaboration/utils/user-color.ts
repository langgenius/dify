/**
 * Generate a consistent color for a user based on their ID
 * Used for cursor colors and avatar backgrounds
 */
export const getUserColor = (id: string): string => {
  const colors = ['#155AEF', '#0BA5EC', '#444CE7', '#7839EE', '#4CA30D', '#0E9384', '#DD2590', '#FF4405', '#D92D20', '#F79009', '#828DAD']
  const hash = id.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0)
    return a & a
  }, 0)
  return colors[Math.abs(hash) % colors.length]
}
