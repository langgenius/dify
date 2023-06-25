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
    switch (key) {
      case 'class':
        acc.className = val
        delete acc.class
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
