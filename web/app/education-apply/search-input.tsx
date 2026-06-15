import type { ChangeEventHandler, UIEventHandler } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { useEducation } from './hooks'

type SearchInputProps = {
  value?: string
  onChange: (value: string) => void
}

const SearchInput = ({
  value,
  onChange,
}: SearchInputProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    schools,
    setSchools,
    querySchoolsWithDebounced,
    handleUpdateSchools,
    hasNext,
  } = useEducation()
  const pageRef = useRef(0)
  const valueRef = useRef(value)

  const handleSearch = useCallback((debounced?: boolean) => {
    const keywords = valueRef.current
    const page = pageRef.current
    if (debounced) {
      querySchoolsWithDebounced({
        keywords,
        page,
      })
      return
    }

    handleUpdateSchools({
      keywords,
      page,
    })
  }, [handleUpdateSchools, querySchoolsWithDebounced])

  const handleValueChange: ChangeEventHandler<HTMLInputElement> = useCallback((e) => {
    setOpen(true)
    setSchools([])
    pageRef.current = 0
    const inputValue = e.target.value
    valueRef.current = inputValue
    onChange(inputValue)
    handleSearch(true)
  }, [handleSearch, onChange, setSchools])

  const handleScroll: UIEventHandler<HTMLDivElement> = useCallback((e) => {
    const target = e.currentTarget
    const {
      scrollTop,
      scrollHeight,
      clientHeight,
    } = target
    if (scrollTop + clientHeight >= scrollHeight - 5 && scrollTop > 0 && hasNext) {
      pageRef.current += 1
      handleSearch()
    }
  }, [handleSearch, hasNext])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={(
          <Input
            className="w-full"
            placeholder={t('form.schoolName.placeholder', { ns: 'education' })}
            value={value}
            onChange={handleValueChange}
          />
        )}
      />
      {!!schools.length && !!value
        ? (
            <PopoverContent
              placement="bottom"
              sideOffset={4}
              popupClassName="w-[var(--anchor-width)] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg"
            >
              <div
                className="max-h-[330px] overflow-y-auto"
                onScroll={handleScroll}
              >
                {schools.map(school => (
                  <div
                    key={school}
                    className="flex h-8 cursor-pointer items-center truncate rounded-lg px-2 py-1.5 system-md-regular text-text-secondary hover:bg-state-base-hover"
                    title={school}
                    onClick={() => {
                      onChange(school)
                      setOpen(false)
                    }}
                  >
                    {school}
                  </div>
                ))}
              </div>
            </PopoverContent>
          )
        : null}
    </Popover>
  )
}

export default SearchInput
