'use client'

import { createToast, createToastManager } from '@langgenius/dify-ui/toast'

export const appConfigurationToastManager = createToastManager()
export const toast = createToast(appConfigurationToastManager)
