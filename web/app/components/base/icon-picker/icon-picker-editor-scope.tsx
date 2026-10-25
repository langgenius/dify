'use client'

import type { ReactNode } from 'react'
import {
  DEFAULT_FIELD_ROOT_CONTEXT,
  FieldRootContext,
} from '@base-ui/react/internals/field-root-context'
import {
  DEFAULT_LABELABLE_CONTEXT,
  LabelableContext,
} from '@base-ui/react/internals/labelable-provider'

// Editing controls belong to the draft, not to the committed icon's Field.
export function IconPickerEditorScope({ children }: { children: ReactNode }) {
  return (
    <FieldRootContext value={DEFAULT_FIELD_ROOT_CONTEXT}>
      <LabelableContext value={DEFAULT_LABELABLE_CONTEXT}>{children}</LabelableContext>
    </FieldRootContext>
  )
}
