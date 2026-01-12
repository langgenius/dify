import { useTheme as useBaseTheme } from 'next-themes'
import { Theme } from '@/types/app'

const useTheme = () => {
  const { theme, resolvedTheme, ...rest } = useBaseTheme()
  return {
    // only returns 'light' or 'dark' theme
    theme: theme === Theme.system ? resolvedTheme as Theme : theme as Theme,
    ...rest,
  }
}

export default useTheme
