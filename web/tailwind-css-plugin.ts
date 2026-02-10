// Credits:
// https://github.com/tailwindlabs/tailwindcss-intellisense/issues/227

import type { PluginCreator } from 'tailwindcss/types/config'
import { readFileSync } from 'node:fs'
import { parse } from 'postcss'
import { objectify } from 'postcss-js'

export const cssAsPlugin: (cssPath: string[]) => PluginCreator = (cssPath: string[]) => {
  const isTailwindCSSIntelliSenseMode = 'TAILWIND_MODE' in process.env
  if (!isTailwindCSSIntelliSenseMode) {
    return () => {}
  }

  return ({ addUtilities, addComponents, addBase }) => {
    const jssList = cssPath.map(p => objectify(parse(readFileSync(p, 'utf8'))))

    for (const jss of jssList) {
      if (jss['@layer utilities'])
        addUtilities(jss['@layer utilities'])
      if (jss['@layer components'])
        addComponents(jss['@layer components'])
      if (jss['@layer base'])
        addBase(jss['@layer base'])
    }
  }
}
