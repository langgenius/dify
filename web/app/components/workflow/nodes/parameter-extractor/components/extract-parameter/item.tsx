'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { Param } from '../../types'
const i18nPrefix = 'workflow.nodes.parameterExtractor'

type Props = {
  payload: Param
  onChange: (payload: Param) => void
}

const Item: FC<Props> = ({
  payload,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <div>
    </div>
  )
}
export default React.memo(Item)
