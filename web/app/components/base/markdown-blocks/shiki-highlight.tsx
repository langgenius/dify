import type { JSX } from 'react'
import type { BundledTheme } from 'shiki/bundle/web'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { bundledLanguages, getSingletonHighlighter } from 'shiki/bundle/web'

type HighlightCodeOptions = {
  code: string
  language: string
  theme: BundledTheme
}

export const highlightCode = async ({
  code,
  language,
  theme,
}: HighlightCodeOptions): Promise<JSX.Element> => {
  const normalizedLanguage = language.trim().toLowerCase()
  const lang =
    normalizedLanguage === 'dotenv' || Object.hasOwn(bundledLanguages, normalizedLanguage)
      ? normalizedLanguage
      : 'text'
  // README fences may name languages outside the web bundle. Load dotenv on
  // demand and keep unknown languages readable without throwing an error.
  const highlighter = await getSingletonHighlighter({
    langs: lang === 'dotenv' ? [(await import('shiki/langs/dotenv.mjs')).default] : [lang],
    themes: [theme],
  })
  const hast = highlighter.codeToHast(code, {
    lang,
    theme,
  })

  return toJsxRuntime(hast, {
    Fragment,
    jsx,
    jsxs,
  }) as JSX.Element
}
