import { useHotkeys } from 'react-hotkeys-hook'


export function useKeyboardShortcuts(shortcuts: { [x: string]: any }) {
  Object.keys(shortcuts).forEach(key => {
    const action = shortcuts[key]
    useHotkeys(key, action)
  })
}