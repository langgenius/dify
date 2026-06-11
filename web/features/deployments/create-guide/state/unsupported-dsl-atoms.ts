'use client'

import type { UnsupportedDslNode } from '@/features/deployments/error'
import { atom } from 'jotai'

export const submissionUnsupportedDslNodesAtom = atom<UnsupportedDslNode[]>([])
