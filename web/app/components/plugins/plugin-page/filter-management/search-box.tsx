'use client'

import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useTranslation } from 'react-i18next'

type SearchBoxProps = {
  searchQuery: string
  onChange: (query: string) => void
}

const SearchBox: React.FC<SearchBoxProps> = ({ searchQuery, onChange }) => {
  const { t } = useTranslation()
  const searchLabel = t(($) => $.search, { ns: 'plugin' })

  return (
    <InputGroup className="w-50">
      <InputGroupInput
        type="search"
        aria-label={searchLabel}
        autoComplete="off"
        className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
        placeholder={searchLabel}
        value={searchQuery}
        onValueChange={onChange}
      />
      <InputGroupAddon className="ps-2 pe-0.5">
        <span
          aria-hidden="true"
          className="i-ri-search-line size-4 text-components-input-text-placeholder"
        />
      </InputGroupAddon>
    </InputGroup>
  )
}

export default SearchBox
