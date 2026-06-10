'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import {
  dslFileAtom,
  selectDslFileAtom,
} from '../../../state/dsl-atoms'

export function DslUploaderField() {
  const dslFile = useAtomValue(dslFileAtom)
  const selectDslFile = useSetAtom(selectDslFileAtom)

  return (
    <Uploader
      className="mt-0"
      file={dslFile}
      updateFile={selectDslFile}
    />
  )
}
