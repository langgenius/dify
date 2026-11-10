import type { SortValue } from '../index'
import { expectTypeOf } from 'vite-plus/test'
import { Sort } from '../index'

const items = [
  { value: 'created_at', name: 'Created time' },
  { value: 'updated_at', name: 'Updated time' },
] as const

export function sortValueTypeContract() {
  return (
    <Sort
      items={items}
      value={{ field: 'created_at', order: 'asc' }}
      onValueChange={(value) => {
        expectTypeOf(value.field).toEqualTypeOf<'created_at' | 'updated_at'>()
        expectTypeOf(value.order).toEqualTypeOf<'asc' | 'desc'>()
      }}
    />
  )
}

export function invalidSortFieldTypeContract() {
  const onValueChange = (_value: SortValue<string>) => {}
  return (
    <Sort
      items={items}
      // @ts-expect-error Neither the value nor a broad callback can widen the fields from items.
      value={{ field: 'unknown', order: 'asc' }}
      onValueChange={onValueChange}
    />
  )
}

export function narrowSortCallbackTypeContract() {
  return (
    <Sort
      items={items}
      value={{ field: 'created_at', order: 'asc' }}
      // @ts-expect-error The callback must handle every field in items.
      onValueChange={(_value: SortValue<'created_at'>) => {}}
    />
  )
}

export function numericSortFieldTypeContract() {
  return (
    <Sort
      items={[
        { value: 0, name: 'First field' },
        { value: 1, name: 'Second field' },
      ]}
      value={{ field: 0, order: 'desc' }}
      onValueChange={(value) => {
        expectTypeOf(value.field).toEqualTypeOf<0 | 1>()
      }}
    />
  )
}

export function invalidSortOrderTypeContract() {
  return (
    <Sort
      items={items}
      // @ts-expect-error Transport prefixes are not sort directions.
      value={{ field: 'created_at', order: '-' }}
      onValueChange={() => {}}
    />
  )
}
