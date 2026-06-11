'use client'

import { atom } from 'jotai'
import {
  instanceDescriptionAtom,
  instanceNameAtom,
  releaseDescriptionAtom,
  releaseNameAtom,
} from './release-atoms'
import { stepAtom } from './workflow-atoms'

export const setInstanceNameAtom = atom(null, (_get, set, value: string) => {
  set(instanceNameAtom, value)
  set(stepAtom, 'release')
})

export const setInstanceDescriptionAtom = atom(null, (_get, set, value: string) => {
  set(instanceDescriptionAtom, value)
  set(stepAtom, 'release')
})

export const setReleaseNameAtom = atom(null, (_get, set, value: string) => {
  set(releaseNameAtom, value)
  set(stepAtom, 'release')
})

export const setReleaseDescriptionAtom = atom(null, (_get, set, value: string) => {
  set(releaseDescriptionAtom, value)
  set(stepAtom, 'release')
})
