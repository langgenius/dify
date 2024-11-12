'use client'
import type { FC } from 'react'
import React from 'react'
import type { PluginDeclaration } from '../../../types'

type Props = {
  plugins: PluginDeclaration[],
  onChange: (plugins: PluginDeclaration[]) => void
}

const SelectPackage: FC<Props> = ({
  plugins,
  onChange,
}) => {
  return (
    <div>
    </div>
  )
}
export default React.memo(SelectPackage)
