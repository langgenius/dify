import type { PluginCreator } from 'tailwindcss/types/config'
import fs from 'node:fs'
import postcss from 'postcss'
import postcssJs from 'postcss-js'

export const cssAsPlugin: (cssPath: string[]) => PluginCreator = (cssPath: string[]) => {
  return ({ addUtilities, addComponents, addBase }) => {
    const jssList = cssPath.map((p) => {
      const css = fs.readFileSync(p, 'utf8')
      return postcssJs.objectify(postcss.parse(css))
    })

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
