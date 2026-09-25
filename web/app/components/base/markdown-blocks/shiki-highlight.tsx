import type { JSX } from 'react'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { createBundledHighlighter, createSingletonShorthands } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { codeLanguages } from './shiki-languages'

const createHighlighter = createBundledHighlighter({
  langs: codeLanguages,
  themes: {
    'github-dark': () => import('shiki/themes/github-dark.mjs'),
    'github-light': () => import('shiki/themes/github-light.mjs'),
  },
  engine: () => createOnigurumaEngine(import('shiki/wasm')),
})

const { getSingletonHighlighter } = createSingletonShorthands(createHighlighter)

export type CodeTheme = 'github-dark' | 'github-light'

type HighlightCodeOptions = {
  code: string
  language: string
  theme: CodeTheme
}

export const highlightCode = async ({
  code,
  language,
  theme,
}: HighlightCodeOptions): Promise<JSX.Element> => {
  const normalizedLanguage = language.trim().toLowerCase()
  const lang =
    normalizedLanguage === 'dotenv' || Object.hasOwn(codeLanguages, normalizedLanguage)
      ? normalizedLanguage
      : 'text'

  // Plain text and unsupported languages do not need syntax highlighting, so
  // skip `getSingletonHighlighter` to avoid loading the WASM engine for them
  // (see #42943). The shiki engine is still loaded on the first real highlight
  // call, so subsequent supported-language code blocks render normally.
  if (lang === 'text') {
    const plainHast = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'pre',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: {},
              children: [{ type: 'text', value: code }],
            },
          ],
        },
      ],
    }
    return toJsxRuntime(plainHast, {
      Fragment,
      jsx,
      jsxs,
    }) as JSX.Element
  }

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
