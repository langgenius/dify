'use client'

import { createDialogHandle } from '@langgenius/dify-ui/dialog'

export const gotoAnythingDialogHandle = createDialogHandle()

let pendingInitialSearchQuery = ''

export const openGotoAnythingDialog = (initialSearchQuery = '') => {
  pendingInitialSearchQuery = initialSearchQuery
  gotoAnythingDialogHandle.open(null)
}

export const consumeInitialSearchQuery = () => {
  const initialSearchQuery = pendingInitialSearchQuery
  pendingInitialSearchQuery = ''
  return initialSearchQuery
}
