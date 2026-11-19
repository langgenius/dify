'use client'
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useTranslation } from '#i18n'
import { useMarketplaceSort } from '../atoms'

const SortMenu = () => {
  const { t } = useTranslation(['plugin'])
  const options = [
    {
      value: 'install_count',
      order: 'DESC',
      text: t(($) => $['marketplace.sortOption.mostPopular'], { ns: 'plugin' }),
    },
    {
      value: 'version_updated_at',
      order: 'DESC',
      text: t(($) => $['marketplace.sortOption.recentlyUpdated'], { ns: 'plugin' }),
    },
    {
      value: 'created_at',
      order: 'DESC',
      text: t(($) => $['marketplace.sortOption.newlyReleased'], { ns: 'plugin' }),
    },
    {
      value: 'created_at',
      order: 'ASC',
      text: t(($) => $['marketplace.sortOption.firstReleased'], { ns: 'plugin' }),
    },
  ]
  const [sort, handleSortChange] = useMarketplaceSort()
  const selectedOption =
    options.find((option) => option.value === sort.sortBy && option.order === sort.sortOrder) ??
    options[0]!

  return (
    <Menu>
      <MenuTrigger className="flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-state-base-hover-alt px-2 pr-3">
        <span className="system-sm-regular text-text-secondary">
          {t(($) => $['marketplace.sortBy'], { ns: 'plugin' })}
        </span>
        <span className="system-sm-medium text-text-primary">{selectedOption.text}</span>
        <span aria-hidden className="i-ri-arrow-down-s-line size-4 text-text-tertiary" />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuRadioGroup
          value={`${selectedOption.value}-${selectedOption.order}`}
          onValueChange={(nextValue) => {
            const option = options.find((option) => `${option.value}-${option.order}` === nextValue)
            if (option) handleSortChange({ sortBy: option.value, sortOrder: option.order })
          }}
        >
          {options.map((option) => (
            <MenuRadioItem
              key={`${option.value}-${option.order}`}
              value={`${option.value}-${option.order}`}
              closeOnClick
              className="justify-between pl-3 system-md-regular text-text-primary"
            >
              {option.text}
              <MenuRadioItemIndicator />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}

export default SortMenu
