import { access, appendFile, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseXml } from '@rgrove/parse-xml'
import { camelCase, template } from 'es-toolkit/compat'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const iconsDir = path.resolve(__dirname, '../app/components/base/icons')

const generateDir = async (currentPath) => {
  try {
    await mkdir(currentPath, { recursive: true })
  }
  catch (err) {
    console.error(err.message)
  }
}
const processSvgStructure = (svgStructure, replaceFillOrStrokeColor) => {
  if (svgStructure?.children.length) {
    svgStructure.children = svgStructure.children.filter(c => c.type !== 'text')

    svgStructure.children.forEach((child) => {
      if (child?.name === 'path' && replaceFillOrStrokeColor) {
        if (child?.attributes?.stroke)
          child.attributes.stroke = 'currentColor'

        if (child?.attributes.fill)
          child.attributes.fill = 'currentColor'
      }
      if (child?.children.length)
        processSvgStructure(child, replaceFillOrStrokeColor)
    })
  }
}
const generateSvgComponent = async (fileHandle, entry, pathList, replaceFillOrStrokeColor) => {
  const currentPath = path.resolve(iconsDir, 'src', ...pathList.slice(2))

  try {
    await access(currentPath)
  }
  catch {
    await generateDir(currentPath)
  }

  const svgString = await fileHandle.readFile({ encoding: 'utf8' })
  const svgJson = parseXml(svgString).toJSON()
  const svgStructure = svgJson.children[0]
  processSvgStructure(svgStructure, replaceFillOrStrokeColor)
  const prefixFileName = camelCase(entry.split('.')[0])
  const fileName = prefixFileName.charAt(0).toUpperCase() + prefixFileName.slice(1)
  const svgData = {
    icon: svgStructure,
    name: fileName,
  }

  const componentRender = template(`
// GENERATE BY script
// DON NOT EDIT IT MANUALLY

import * as React from 'react'
import data from './<%= svgName %>.json'
import IconBase from '@/app/components/base/icons/IconBase'
import type { IconData } from '@/app/components/base/icons/IconBase'

const Icon = (
  {
    ref,
    ...props
  }: React.SVGProps<SVGSVGElement> & {
    ref?: React.RefObject<React.RefObject<HTMLOrSVGElement>>;
  },
) => <IconBase {...props} ref={ref} data={data as IconData} />

Icon.displayName = '<%= svgName %>'

export default Icon
`.trim())

  await writeFile(path.resolve(currentPath, `${fileName}.json`), `${JSON.stringify(svgData, '', '\t')}\n`)
  await writeFile(path.resolve(currentPath, `${fileName}.tsx`), `${componentRender({ svgName: fileName })}\n`)

  const indexingRender = template(`
export { default as <%= svgName %> } from './<%= svgName %>'
`.trim())

  await appendFile(path.resolve(currentPath, 'index.ts'), `${indexingRender({ svgName: fileName })}\n`)
}

const generateImageComponent = async (entry, pathList) => {
  const currentPath = path.resolve(iconsDir, 'src', ...pathList.slice(2))

  try {
    await access(currentPath)
  }
  catch {
    await generateDir(currentPath)
  }

  const prefixFileName = camelCase(entry.split('.')[0])
  const fileName = prefixFileName.charAt(0).toUpperCase() + prefixFileName.slice(1)

  const componentCSSRender = template(`
.wrapper {
  display: inline-flex;
  background: url(<%= assetPath %>) center center no-repeat;
  background-size: contain;
}
`.trim())

  await writeFile(path.resolve(currentPath, `${fileName}.module.css`), `${componentCSSRender({ assetPath: path.posix.join('~@/app/components/base/icons/assets', ...pathList.slice(2), entry) })}\n`)

  const componentRender = template(`
// GENERATE BY script
// DON NOT EDIT IT MANUALLY

import * as React from 'react'
import { cn } from '@/utils/classnames'
import s from './<%= fileName %>.module.css'

const Icon = (
  {
    ref,
    className,
    ...restProps
  }: React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> & {
    ref?: React.RefObject<HTMLSpanElement>;
  },
) => <span className={cn(s.wrapper, className)} {...restProps} ref={ref} />

Icon.displayName = '<%= fileName %>'

export default Icon
`.trim())

  await writeFile(path.resolve(currentPath, `${fileName}.tsx`), `${componentRender({ fileName })}\n`)

  const indexingRender = template(`
export { default as <%= fileName %> } from './<%= fileName %>'
`.trim())

  await appendFile(path.resolve(currentPath, 'index.ts'), `${indexingRender({ fileName })}\n`)
}

const walk = async (entry, pathList, replaceFillOrStrokeColor) => {
  const currentPath = path.resolve(...pathList, entry)
  let fileHandle

  try {
    fileHandle = await open(currentPath)
    const stat = await fileHandle.stat()

    if (stat.isDirectory()) {
      const files = await readdir(currentPath)

      for (const file of files)
        await walk(file, [...pathList, entry], replaceFillOrStrokeColor)
    }

    if (stat.isFile() && /.+\.svg$/.test(entry))
      await generateSvgComponent(fileHandle, entry, pathList, replaceFillOrStrokeColor)

    if (stat.isFile() && /.+\.png$/.test(entry))
      await generateImageComponent(entry, pathList)
  }
  finally {
    fileHandle?.close()
  }
}

(async () => {
  await rm(path.resolve(iconsDir, 'src'), { recursive: true, force: true })
  await walk('public', [iconsDir, 'assets'])
  await walk('vender', [iconsDir, 'assets'], true)
  await walk('image', [iconsDir, 'assets'])
})()
