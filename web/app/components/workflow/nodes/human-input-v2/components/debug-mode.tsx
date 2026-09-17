'use client'

import type { HumanInputV2DebugMode } from '../types'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { ContactChannelIcon } from '@/features/contacts/management/channel-icon'
import { HUMAN_INPUT_V2_DEBUG_CHANNELS, isHumanInputV2DebugChannel } from '../types'

// Original stripe background exported from Studio Figma node 25212:78484.
const debugModeBackground =
  'data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjEyMTkuMjQiIGhlaWdodD0iMTE1Ljk2NiIgdmlld0JveD0iMCAwIDEyMTkuMjQgMTE1Ljk2NiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgaWQ9IlZlY3RvciIgb3BhY2l0eT0iMC41Ij4KPHBhdGggZD0iTTExMi40MyAwTDExNS45NjYgMy41MzU1M0wzLjUzNTUzIDExNS45NjZMMCAxMTIuNDNMMTEyLjQzIDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTEyNi4zOTUgMEwxMjkuOTMxIDMuNTM1NTNMMTcuNTAxIDExNS45NjZMMTMuOTY1NSAxMTIuNDNMMTI2LjM5NSAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0xNDAuMzYxIDBMMTQzLjg5NyAzLjUzNTUzTDMxLjQ2NjUgMTE1Ljk2NkwyNy45MzEgMTEyLjQzTDE0MC4zNjEgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMTU0LjMyNiAwTDE1Ny44NjIgMy41MzU1M0w0NS40MzIgMTE1Ljk2Nkw0MS44OTY1IDExMi40M0wxNTQuMzI2IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTE2OC4yOTIgMEwxNzEuODI4IDMuNTM1NTNMNTkuMzk3NiAxMTUuOTY2TDU1Ljg2MiAxMTIuNDNMMTY4LjI5MiAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0xODIuMjU4IDBMMTg1Ljc5MyAzLjUzNTUzTDczLjM2MzEgMTE1Ljk2Nkw2OS44Mjc1IDExMi40M0wxODIuMjU4IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTE5Ni4yMjMgMEwxOTkuNzU5IDMuNTM1NTNMODcuMzI4NiAxMTUuOTY2TDgzLjc5MyAxMTIuNDNMMTk2LjIyMyAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0yMTAuMTg5IDBMMjEzLjcyNCAzLjUzNTUzTDEwMS4yOTQgMTE1Ljk2Nkw5Ny43NTg1IDExMi40M0wyMTAuMTg5IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTIyNC4xNTQgMEwyMjcuNjkgMy41MzU1M0wxMTUuMjYgMTE1Ljk2NkwxMTEuNzI0IDExMi40M0wyMjQuMTU0IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTIzOC4xMiAwTDI0MS42NTUgMy41MzU1M0wxMjkuMjI1IDExNS45NjZMMTI1LjY5IDExMi40M0wyMzguMTIgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMjUyLjA4NSAwTDI1NS42MjEgMy41MzU1M0wxNDMuMTkxIDExNS45NjZMMTM5LjY1NSAxMTIuNDNMMjUyLjA4NSAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0yNjYuMDUxIDBMMjY5LjU4NiAzLjUzNTUzTDE1Ny4xNTYgMTE1Ljk2NkwxNTMuNjIxIDExMi40M0wyNjYuMDUxIDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTI4MC4wMTYgMEwyODMuNTUyIDMuNTM1NTNMMTcxLjEyMiAxMTUuOTY2TDE2Ny41ODYgMTEyLjQzTDI4MC4wMTYgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMjkzLjk4MiAwTDI5Ny41MTcgMy41MzU1M0wxODUuMDg3IDExNS45NjZMMTgxLjU1MiAxMTIuNDNMMjkzLjk4MiAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0zMDcuOTQ3IDBMMzExLjQ4MyAzLjUzNTUzTDE5OS4wNTMgMTE1Ljk2NkwxOTUuNTE3IDExMi40M0wzMDcuOTQ3IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTMyMS45MTMgMEwzMjUuNDQ4IDMuNTM1NTNMMjEzLjAxOCAxMTUuOTY2TDIwOS40ODMgMTEyLjQzTDMyMS45MTMgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMzM1Ljg3OCAwTDMzOS40MTQgMy41MzU1M0wyMjYuOTg0IDExNS45NjZMMjIzLjQ0OCAxMTIuNDNMMzM1Ljg3OCAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0zNDkuODQ0IDBMMzUzLjM3OSAzLjUzNTUzTDI0MC45NDkgMTE1Ljk2NkwyMzcuNDE0IDExMi40M0wzNDkuODQ0IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTM2My44MDkgMEwzNjcuMzQ1IDMuNTM1NTNMMjU0LjkxNSAxMTUuOTY2TDI1MS4zNzkgMTEyLjQzTDM2My44MDkgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMzc3Ljc3NSAwTDM4MS4zMSAzLjUzNTUzTDI2OC44OCAxMTUuOTY2TDI2NS4zNDUgMTEyLjQzTDM3Ny43NzUgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMzkxLjc0IDBMMzk1LjI3NiAzLjUzNTUzTDI4Mi44NDYgMTE1Ljk2NkwyNzkuMzEgMTEyLjQzTDM5MS43NCAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik00MDUuNzA2IDBMNDA5LjI0MSAzLjUzNTUzTDI5Ni44MTEgMTE1Ljk2NkwyOTMuMjc2IDExMi40M0w0MDUuNzA2IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTQxOS42NzEgMEw0MjMuMjA3IDMuNTM1NTNMMzEwLjc3NyAxMTUuOTY2TDMwNy4yNDEgMTEyLjQzTDQxOS42NzEgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNNDMzLjYzNyAwTDQzNy4xNzIgMy41MzU1M0wzMjQuNzQyIDExNS45NjZMMzIxLjIwNyAxMTIuNDNMNDMzLjYzNyAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik00NDcuNjAyIDBMNDUxLjEzOCAzLjUzNTUzTDMzOC43MDggMTE1Ljk2NkwzMzUuMTcyIDExMi40M0w0NDcuNjAyIDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTQ2MS41NjggMEw0NjUuMTAzIDMuNTM1NTNMMzUyLjY3MyAxMTUuOTY2TDM0OS4xMzggMTEyLjQzTDQ2MS41NjggMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNNDc1LjUzMyAwTDQ3OS4wNjkgMy41MzU1M0wzNjYuNjM5IDExNS45NjZMMzYzLjEwMyAxMTIuNDNMNDc1LjUzMyAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik00ODkuNDk5IDBMNDkzLjAzNCAzLjUzNTUzTDM4MC42MDQgMTE1Ljk2NkwzNzcuMDY5IDExMi40M0w0ODkuNDk5IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTUwMy40NjQgMEw1MDcgMy41MzU1M0wzOTQuNTcgMTE1Ljk2NkwzOTEuMDM0IDExMi40M0w1MDMuNDY0IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTUxNy40MyAwTDUyMC45NjUgMy41MzU1M0w0MDguNTM1IDExNS45NjZMNDA1IDExMi40M0w1MTcuNDMgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNNTMxLjM5NSAwTDUzNC45MzEgMy41MzU1M0w0MjIuNTAxIDExNS45NjZMNDE4Ljk2NSAxMTIuNDNMNTMxLjM5NSAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik01NDUuMzYxIDBMNTQ4Ljg5NiAzLjUzNTUzTDQzNi40NjYgMTE1Ljk2Nkw0MzIuOTMxIDExMi40M0w1NDUuMzYxIDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTU1OS4zMjYgMEw1NjIuODYyIDMuNTM1NTNMNDUwLjQzMiAxMTUuOTY2TDQ0Ni44OTYgMTEyLjQzTDU1OS4zMjYgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNNTczLjI5MiAwTDU3Ni44MjcgMy41MzU1M0w0NjQuMzk3IDExNS45NjZMNDYwLjg2MiAxMTIuNDNMNTczLjI5MiAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik01ODcuMjU3IDBMNTkwLjc5MyAzLjUzNTUzTDQ3OC4zNjMgMTE1Ljk2Nkw0NzQuODI3IDExMi40M0w1ODcuMjU3IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTYwMS4yMjMgMEw2MDQuNzU4IDMuNTM1NTNMNDkyLjMyOCAxMTUuOTY2TDQ4OC43OTMgMTEyLjQzTDYwMS4yMjMgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNNjE1LjE4OCAwTDYxOC43MjQgMy41MzU1M0w1MDYuMjk0IDExNS45NjZMNTAyLjc1OCAxMTIuNDNMNjE1LjE4OCAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik02MjkuMTU0IDBMNjMyLjY4OSAzLjUzNTUzTDUyMC4yNTkgMTE1Ljk2Nkw1MTYuNzI0IDExMi40M0w2MjkuMTU0IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTY0My4xMTkgMEw2NDYuNjU1IDMuNTM1NTNMNTM0LjIyNSAxMTUuOTY2TDUzMC42ODkgMTEyLjQzTDY0My4xMTkgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNNjU3LjA4NSAwTDY2MC42MiAzLjUzNTUzTDU0OC4xOSAxMTUuOTY2TDU0NC42NTUgMTEyLjQzTDY1Ny4wODUgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNNjcxLjA1IDBMNjc0LjU4NiAzLjUzNTUzTDU2Mi4xNTYgMTE1Ljk2Nkw1NTguNjIgMTEyLjQzTDY3MS4wNSAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik02ODUuMDE2IDBMNjg4LjU1MiAzLjUzNTUzTDU3Ni4xMjIgMTE1Ljk2Nkw1NzIuNTg2IDExMi40M0w2ODUuMDE2IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTY5OC45ODIgMEw3MDIuNTE3IDMuNTM1NTNMNTkwLjA4NyAxMTUuOTY2TDU4Ni41NTIgMTEyLjQzTDY5OC45ODIgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNNzEyLjk0NyAwTDcxNi40ODMgMy41MzU1M0w2MDQuMDUzIDExNS45NjZMNjAwLjUxNyAxMTIuNDNMNzEyLjk0NyAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik03MjYuOTEzIDBMNzMwLjQ0OCAzLjUzNTUzTDYxOC4wMTggMTE1Ljk2Nkw2MTQuNDgzIDExMi40M0w3MjYuOTEzIDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTc0MC44NzggMEw3NDQuNDE0IDMuNTM1NTNMNjMxLjk4NCAxMTUuOTY2TDYyOC40NDggMTEyLjQzTDc0MC44NzggMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNNzU0Ljg0NCAwTDc1OC4zNzkgMy41MzU1M0w2NDUuOTQ5IDExNS45NjZMNjQyLjQxNCAxMTIuNDNMNzU0Ljg0NCAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik03NjguODA5IDBMNzcyLjM0NSAzLjUzNTUzTDY1OS45MTUgMTE1Ljk2Nkw2NTYuMzc5IDExMi40M0w3NjguODA5IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTc4Mi43NzUgMEw3ODYuMzEgMy41MzU1M0w2NzMuODggMTE1Ljk2Nkw2NzAuMzQ1IDExMi40M0w3ODIuNzc1IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTc5Ni43NCAwTDgwMC4yNzYgMy41MzU1M0w2ODcuODQ2IDExNS45NjZMNjg0LjMxIDExMi40M0w3OTYuNzQgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNODEwLjcwNiAwTDgxNC4yNDEgMy41MzU1M0w3MDEuODExIDExNS45NjZMNjk4LjI3NiAxMTIuNDNMODEwLjcwNiAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik04MjQuNjcxIDBMODI4LjIwNyAzLjUzNTUzTDcxNS43NzcgMTE1Ljk2Nkw3MTIuMjQxIDExMi40M0w4MjQuNjcxIDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTgzOC42MzcgMEw4NDIuMTcyIDMuNTM1NTNMNzI5Ljc0MiAxMTUuOTY2TDcyNi4yMDcgMTEyLjQzTDgzOC42MzcgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNODUyLjYwMiAwTDg1Ni4xMzggMy41MzU1M0w3NDMuNzA4IDExNS45NjZMNzQwLjE3MiAxMTIuNDNMODUyLjYwMiAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik04NjYuNTY4IDBMODcwLjEwMyAzLjUzNTUzTDc1Ny42NzMgMTE1Ljk2Nkw3NTQuMTM4IDExMi40M0w4NjYuNTY4IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTg4MC41MzMgMEw4ODQuMDY5IDMuNTM1NTNMNzcxLjYzOSAxMTUuOTY2TDc2OC4xMDMgMTEyLjQzTDg4MC41MzMgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNODk0LjQ5OSAwTDg5OC4wMzQgMy41MzU1M0w3ODUuNjA0IDExNS45NjZMNzgyLjA2OSAxMTIuNDNMODk0LjQ5OSAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik05MDguNDY0IDBMOTEyIDMuNTM1NTNMNzk5LjU3IDExNS45NjZMNzk2LjAzNCAxMTIuNDNMOTA4LjQ2NCAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik05MjIuNDMgMEw5MjUuOTY1IDMuNTM1NTNMODEzLjUzNSAxMTUuOTY2TDgxMCAxMTIuNDNMOTIyLjQzIDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTkzNi4zOTUgMEw5MzkuOTMxIDMuNTM1NTNMODI3LjUwMSAxMTUuOTY2TDgyMy45NjUgMTEyLjQzTDkzNi4zOTUgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNOTUwLjM2MSAwTDk1My44OTYgMy41MzU1M0w4NDEuNDY2IDExNS45NjZMODM3LjkzMSAxMTIuNDNMOTUwLjM2MSAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik05NjQuMzI2IDBMOTY3Ljg2MiAzLjUzNTUzTDg1NS40MzIgMTE1Ljk2Nkw4NTEuODk2IDExMi40M0w5NjQuMzI2IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTk3OC4yOTIgMEw5ODEuODI3IDMuNTM1NTNMODY5LjM5NyAxMTUuOTY2TDg2NS44NjIgMTEyLjQzTDk3OC4yOTIgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNOTkyLjI1NyAwTDk5NS43OTMgMy41MzU1M0w4ODMuMzYzIDExNS45NjZMODc5LjgyNyAxMTIuNDNMOTkyLjI1NyAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0xMDA2LjIyIDBMMTAwOS43NiAzLjUzNTUzTDg5Ny4zMjggMTE1Ljk2Nkw4OTMuNzkzIDExMi40M0wxMDA2LjIyIDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTEwMjAuMTkgMEwxMDIzLjcyIDMuNTM1NTNMOTExLjI5NCAxMTUuOTY2TDkwNy43NTggMTEyLjQzTDEwMjAuMTkgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMTAzNC4xNSAwTDEwMzcuNjkgMy41MzU1M0w5MjUuMjU5IDExNS45NjZMOTIxLjcyNCAxMTIuNDNMMTAzNC4xNSAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0xMDQ4LjEyIDBMMTA1MS42NSAzLjUzNTUzTDkzOS4yMjUgMTE1Ljk2Nkw5MzUuNjg5IDExMi40M0wxMDQ4LjEyIDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTEwNjIuMDggMEwxMDY1LjYyIDMuNTM1NTNMOTUzLjE5IDExNS45NjZMOTQ5LjY1NSAxMTIuNDNMMTA2Mi4wOCAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0xMDc2LjA1IDBMMTA3OS41OSAzLjUzNTUzTDk2Ny4xNTYgMTE1Ljk2Nkw5NjMuNjIgMTEyLjQzTDEwNzYuMDUgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMTA5MC4wMiAwTDEwOTMuNTUgMy41MzU1M0w5ODEuMTIxIDExNS45NjZMOTc3LjU4NiAxMTIuNDNMMTA5MC4wMiAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0xMTAzLjk4IDBMMTEwNy41MiAzLjUzNTUzTDk5NS4wODcgMTE1Ljk2Nkw5OTEuNTUxIDExMi40M0wxMTAzLjk4IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTExMTcuOTUgMEwxMTIxLjQ4IDMuNTM1NTNMMTAwOS4wNSAxMTUuOTY2TDEwMDUuNTIgMTEyLjQzTDExMTcuOTUgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMTEzMS45MSAwTDExMzUuNDUgMy41MzU1M0wxMDIzLjAyIDExNS45NjZMMTAxOS40OCAxMTIuNDNMMTEzMS45MSAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0xMTQ1Ljg4IDBMMTE0OS40MSAzLjUzNTUzTDEwMzYuOTggMTE1Ljk2NkwxMDMzLjQ1IDExMi40M0wxMTQ1Ljg4IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTExNTkuODQgMEwxMTYzLjM4IDMuNTM1NTNMMTA1MC45NSAxMTUuOTY2TDEwNDcuNDEgMTEyLjQzTDExNTkuODQgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMTE3My44MSAwTDExNzcuMzQgMy41MzU1M0wxMDY0LjkxIDExNS45NjZMMTA2MS4zOCAxMTIuNDNMMTE3My44MSAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjxwYXRoIGQ9Ik0xMTg3Ljc3IDBMMTE5MS4zMSAzLjUzNTUzTDEwNzguODggMTE1Ljk2NkwxMDc1LjM0IDExMi40M0wxMTg3Ljc3IDBaIiBmaWxsPSIjMTAxODI4IiBmaWxsLW9wYWNpdHk9IjAuMDQiLz4KPHBhdGggZD0iTTEyMDEuNzQgMEwxMjA1LjI4IDMuNTM1NTNMMTA5Mi44NSAxMTUuOTY2TDEwODkuMzEgMTEyLjQzTDEyMDEuNzQgMFoiIGZpbGw9IiMxMDE4MjgiIGZpbGwtb3BhY2l0eT0iMC4wNCIvPgo8cGF0aCBkPSJNMTIxNS43MSAwTDEyMTkuMjQgMy41MzU1M0wxMTA2LjgxIDExNS45NjZMMTEwMy4yOCAxMTIuNDNMMTIxNS43MSAwWiIgZmlsbD0iIzEwMTgyOCIgZmlsbC1vcGFjaXR5PSIwLjA0Ii8+CjwvZz4KPC9zdmc+Cg=='

type DebugModeProps = {
  value: HumanInputV2DebugMode
  onChange: (value: HumanInputV2DebugMode) => void
  readonly: boolean
}

const DebugMode = ({ value, onChange, readonly }: DebugModeProps) => {
  const { t } = useTranslation()
  const errorId = useId()
  const [open, setOpen] = useState(false)
  const channels = value.channels as string[]
  const unsupported = channels.filter((channel) => !isHumanInputV2DebugChannel(channel))
  const selected = channels.filter(isHumanInputV2DebugChannel)

  const toggleChannel = (channel: (typeof HUMAN_INPUT_V2_DEBUG_CHANNELS)[number]) => {
    const nextChannels = channels.includes(channel)
      ? channels.filter((item) => item !== channel)
      : [...channels, channel]
    onChange({ ...value, channels: nextChannels as HumanInputV2DebugMode['channels'] })
  }

  return (
    <section
      className="px-4"
      aria-describedby={
        (value.enabled && !selected.length) || unsupported.length ? errorId : undefined
      }
    >
      <div
        className={cn(
          'relative flex h-9 items-center gap-2 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pr-2.5 pl-2 shadow-xs',
          readonly && 'opacity-70',
        )}
      >
        <img
          src={debugModeBackground}
          alt=""
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 h-[115.966px] w-[1219.24px] max-w-none -translate-x-1/2 -translate-y-1/2"
        />
        <span className="relative flex size-5 shrink-0 items-center justify-center rounded-md border border-divider-regular bg-components-icon-bg-orange-dark-solid bg-linear-to-br from-components-avatar-bg-mask-stop-0 to-components-avatar-bg-mask-stop-100 text-text-primary-on-surface">
          <span className="i-ri-bug-line size-3.5" aria-hidden />
        </span>
        <div className="relative flex min-w-0 grow items-center gap-1">
          <div className="truncate system-sm-medium text-text-secondary">
            {t(($) => $['nodes.humanInputV2.debug.title'], { ns: 'workflow' })}
          </div>
          <Infotip aria-label={t(($) => $['nodes.humanInputV2.debug.title'], { ns: 'workflow' })}>
            {t(($) => $['nodes.humanInputV2.debug.sendVia'], { ns: 'workflow' })}
          </Infotip>
        </div>
        <Popover open={open} onOpenChange={(nextOpen) => !readonly && setOpen(nextOpen)}>
          <PopoverTrigger
            render={
              <button
                type="button"
                disabled={readonly}
                aria-label={t(($) => $['nodes.humanInputV2.debug.configure'], { ns: 'workflow' })}
                className="relative flex h-6 shrink-0 items-center justify-center gap-1 rounded-lg border-0 bg-transparent p-1 text-text-tertiary hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed"
              >
                {!!selected.length && (
                  <span
                    role="img"
                    aria-label={selected
                      .map((channel) =>
                        t(($) => $[`nodes.humanInputV2.debug.channel.${channel}`], {
                          ns: 'workflow',
                        }),
                      )
                      .join(', ')}
                    className="flex items-center gap-1"
                  >
                    {selected.map((channel) => (
                      <ContactChannelIcon key={channel} provider={channel} className="size-4" />
                    ))}
                  </span>
                )}
                <span className="i-ri-equalizer-2-line size-4" aria-hidden />
              </button>
            }
          />
          <PopoverContent
            placement="bottom-end"
            sideOffset={4}
            className="w-60! bg-components-panel-bg-blur p-1! backdrop-blur-[5px]"
          >
            <div className="px-2 pt-1 pb-0.5 system-xs-medium text-text-tertiary">
              {t(($) => $['nodes.humanInputV2.debug.sendVia'], { ns: 'workflow' })}
            </div>
            {HUMAN_INPUT_V2_DEBUG_CHANNELS.map((channel) => (
              <label
                key={channel}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-state-base-hover"
              >
                <Checkbox
                  checked={channels.includes(channel)}
                  onCheckedChange={() => toggleChannel(channel)}
                />
                <ContactChannelIcon provider={channel} className="size-4" />
                <span className="system-md-regular text-text-secondary">
                  {t(($) => $[`nodes.humanInputV2.debug.channel.${channel}`], { ns: 'workflow' })}
                </span>
              </label>
            ))}
          </PopoverContent>
        </Popover>
        <div className="relative h-3 w-1.25 shrink-0 border-l border-divider-regular" />
        <Switch
          aria-label={t(($) => $['nodes.humanInputV2.debug.toggle'], { ns: 'workflow' })}
          aria-describedby={value.enabled && !selected.length ? errorId : undefined}
          checked={value.enabled}
          disabled={readonly}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      {value.enabled && !selected.length && (
        <div id={errorId} role="alert" className="mt-1 system-xs-regular text-text-destructive">
          {t(($) => $['nodes.humanInputV2.error.debugChannelRequired'], { ns: 'workflow' })}
        </div>
      )}
      {!!unsupported.length && (
        <div
          id={value.enabled && !selected.length ? undefined : errorId}
          role="alert"
          className="mt-1 system-xs-regular text-text-destructive"
        >
          {t(($) => $['nodes.humanInputV2.debug.unsupported'], {
            ns: 'workflow',
            channels: unsupported.join(', '),
          })}
        </div>
      )}
    </section>
  )
}

export default DebugMode
