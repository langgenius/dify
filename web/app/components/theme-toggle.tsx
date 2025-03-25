'use client'

import { useEffect } from 'react'
import { MoonIcon, SunIcon } from '@heroicons/react/24/outline'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'

const ThemeToggle = () => {
  const { theme, setTheme } = useTheme()

  const toggleTheme = () => {
    // Toggle between light and dark themes
    const newTheme = theme === Theme.light ? Theme.dark : Theme.light
    setTheme(newTheme)
  }

  return (
    <button
      onClick={toggleTheme}
      className={`rounded-md p-2 transition-colors ${
        theme === Theme.dark 
          ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-200' 
          : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
      }`}
      aria-label={theme === Theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
      data-testid="theme-toggle"
    >
      {theme === Theme.dark ? (
        <MoonIcon className="h-5 w-5 text-indigo-400" />
      ) : (
        <SunIcon className="h-5 w-5 text-yellow-500" />
      )}
    </button>
  )
}

export default ThemeToggle