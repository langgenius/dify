import type { ElementNode } from '@openuidev/lang-core'
import { SelectFieldDefinition, TableDefinition, TextFieldDefinition } from './registry/definitions'

const contentTypes = new Set([
  'Text',
  'Heading',
  'Status',
  'Table',
  'LineChart',
  'BarChart',
  'MetricCard',
  'ActionButton',
  'Form',
])

function isElement(value: unknown): value is ElementNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'element' &&
    'typeName' in value &&
    typeof value.typeName === 'string' &&
    'props' in value &&
    typeof value.props === 'object' &&
    value.props !== null &&
    'partial' in value &&
    typeof value.partial === 'boolean'
  )
}

export type ValidatedUIContent = {
  children: ElementNode[]
  hasContent: boolean
  invalidCount: number
}

/** Validate relationships the OpenUI parser's positional prop checks do not enforce. */
export function validateUIContent(children: unknown, unavailableText: string): ValidatedUIContent {
  const formCounts = new Map<string, number>()
  function collectForms(value: unknown) {
    if (!Array.isArray(value)) return
    for (const node of value) {
      if (!isElement(node)) continue
      if (node.typeName === 'Form' && typeof node.props.name === 'string') {
        formCounts.set(node.props.name, (formCounts.get(node.props.name) ?? 0) + 1)
      } else if (node.typeName === 'Card') {
        collectForms(node.props.children)
      }
    }
  }
  collectForms(children)

  function validForm(node: ElementNode) {
    const { name, fields } = node.props
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      formCounts.get(name) !== 1 ||
      !Array.isArray(fields)
    ) {
      return false
    }
    const names = new Set<string>()
    return fields.every((field: unknown) => {
      if (!isElement(field) || field.partial) return false
      const name = field.props.name
      if (typeof name !== 'string' || !name.trim() || names.has(name)) return false
      names.add(name)
      if (field.typeName === 'TextField')
        return TextFieldDefinition.props.safeParse(field.props).success
      if (field.typeName !== 'SelectField') return false
      const parsed = SelectFieldDefinition.props.safeParse(field.props)
      return (
        parsed.success &&
        (parsed.data.initialValue === '' || parsed.data.options.includes(parsed.data.initialValue))
      )
    })
  }

  function validate(value: unknown, allowCards: boolean): ValidatedUIContent {
    const result: ValidatedUIContent = { children: [], hasContent: false, invalidCount: 0 }
    if (!Array.isArray(value)) return result
    for (const node of value) {
      let valid =
        isElement(node) &&
        !node.partial &&
        (contentTypes.has(node.typeName) || (allowCards && node.typeName === 'Card'))
      if (valid && isElement(node)) {
        if (node.typeName === 'Form') valid = validForm(node)
        if (node.typeName === 'Table') {
          const table = TableDefinition.props.safeParse(node.props)
          valid =
            table.success &&
            table.data.rows.every((row) => row.length === table.data.columns.length)
        }
      }
      if (!valid || !isElement(node)) {
        result.invalidCount++
        result.children.push({
          type: 'element',
          typeName: 'Text',
          partial: false,
          props: { content: unavailableText },
        })
        continue
      }
      result.hasContent = true
      if (node.typeName === 'Card') {
        const nested = validate(node.props.children, false)
        result.invalidCount += nested.invalidCount
        result.children.push(
          nested.invalidCount
            ? { ...node, props: { ...node.props, children: nested.children } }
            : node,
        )
      } else {
        result.children.push(node)
      }
    }
    return result
  }
  return validate(children, true)
}
