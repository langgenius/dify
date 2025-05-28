import { Theme } from '@/types/app'
import { useTheme as useBaseTheme } from 'next-themes'

const useTheme = () => {
  const { theme, resolvedTheme, ...rest } = useBaseTheme()
  return {
    // only returns 'light' or 'dark' theme
    theme: theme === Theme.system ? resolvedTheme as Theme : theme as Theme,
    ...rest,
  }
}

export default useTheme
