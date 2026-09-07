'use client'

import { createToast, createToastManager } from '@langgenius/dify-ui/toast'

const appConfigurationToastManager = createToastManager()
const toast = createToast(appConfigurationToastManager)

export { appConfigurationToastManager, toast }
