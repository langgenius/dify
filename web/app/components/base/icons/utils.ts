import React from 'react'

export type AbstractNode = {
  name: string
  attributes: {
    [key: string]: string
  }
  children?: AbstractNode[]
}

export type Attrs = {
  [key: string]: string
}

export function normalizeAttrs(attrs: Attrs = {}): Attrs {
  return Object.keys(attrs).reduce((acc: Attrs, key) => {
    const val = attrs[key]
    key = key.replace(/([-]\w)/g, (g: string) => g[1].toUpperCase())
    key = key.replace(/([:]\w)/g, (g: string) => g[1].toUpperCase())
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
