import type { HotkeyChord } from '@tanstack/react-hotkeys'

export const skillFileHotkeys = {
  copy: {
    command: 'Mod+C' satisfies HotkeyChord,
  },
  cut: {
    command: 'Mod+X' satisfies HotkeyChord,
  },
  paste: { command: 'Mod+V' satisfies HotkeyChord },
} as const

export const skillFileDragType = 'application/x-dify-skill-file-path'

export const skillFileDragPathsType = 'application/x-dify-skill-file-paths'

export type SkillFileClipboard = {
  mode: 'copy' | 'cut'
  paths: string[]
}

export function getDraggedSkillPaths(dataTransfer: DataTransfer) {
  const rawPaths = dataTransfer.getData(skillFileDragPathsType)
  if (rawPaths) {
    try {
      const parsedPaths: unknown = JSON.parse(rawPaths)
      if (Array.isArray(parsedPaths))
        return parsedPaths.filter((path): path is string => typeof path === 'string' && !!path)
    } catch {
      return []
    }
  }

  const sourcePath = dataTransfer.getData(skillFileDragType)
  return sourcePath ? [sourcePath] : []
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  const tagName = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]')) ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  )
}
