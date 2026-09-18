'use client'

import { createToast, createToastManager } from '@langgenius/dify-ui/toast'

export const manager = createToastManager()
export const toast = createToast(manager)
