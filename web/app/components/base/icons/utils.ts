import React from 'react'

export type AbstractNode = {
  name: string
  attributes: {
    [key: string]: string | undefined
  }
  children?: AbstractNode[]
}

export type Attrs = {
  [key: string]: string | undefined
}

export function normalizeAttrs(attrs: Attrs = {}): Attrs {
  return Object.keys(attrs).reduce((acc: Attrs, key) => {
    // Filter out editor metadata attributes before processing
    if (key.startsWith('inkscape:')
        || key.startsWith('sodipodi:')
        || key.startsWith('xmlns:inkscape')
        || key.startsWith('xmlns:sodipodi')
        || key.startsWith('xmlns:svg')
        || key === 'data-name')
      return acc

    const val = attrs[key]
    if (val === undefined)
      return acc

    key = key.replace(/([-]\w)/g, (g: string) => g[1].toUpperCase())
    key = key.replace(/([:]\w)/g, (g: string) => g[1].toUpperCase())

    // Additional filter after camelCase conversion
    if (key === 'xmlnsInkscape'
        || key === 'xmlnsSodipodi'
        || key === 'xmlnsSvg'
        || key === 'dataName')
      return acc

    switch (key) {
      case 'class':
        acc.className = val
        delete acc.class
        break
      case 'style':
        (acc.style as any) = val.split(';').reduce((prev, next) => {
          const pairs = next?.split(':')

          if (pairs[0] && pairs[1]) {
            const k = pairs[0].replace(/([-]\w)/g, (g: string) => g[1].toUpperCase())
            prev[k] = pairs[1]
          }

          return prev
        }, {} as Attrs)
        break
      default:
        acc[key] = val
    }
    return acc
  }, {})
}

export function generate(
  node: AbstractNode,
  key: string,
  rootProps?: { [key: string]: any } | false,
): any {
  if (!rootProps) {
    return React.createElement(
      node.name,
      { key, ...normalizeAttrs(node.attributes) },
      (node.children || []).map((child, index) => generate(child, `${key}-${node.name}-${index}`)),
    )
  }

  return React.createElement(
    node.name,
    {
      key,
      ...normalizeAttrs(node.attributes),
      ...rootProps,
    },
    (node.children || []).map((child, index) => generate(child, `${key}-${node.name}-${index}`)),
  )
}
