'use client'

import { useState } from 'react'
import { FormattedText } from '../components/datasets/formatted-text/formatted'
import { PreviewSlice } from '../components/datasets/formatted-text/flavours/preview-slice'
import { PreviewContainer } from '../components/datasets/preview/container'
import { PreviewHeader } from '../components/datasets/preview/header'
import FileIcon from '../components/base/file-icon'
import { ChevronDown } from '../components/base/icons/src/vender/solid/arrows'
import Badge from '../components/base/badge'
import { DividerWithLabel } from '../components/base/divider/with-label'
import Button from '../components/base/button'
import { ChunkContainer, QAPreview } from '../components/datasets/chunk'
import classNames from '@/utils/classnames'

export default function Page() {
  const [parentChild, setParentChild] = useState(false)
  const [vertical, setVertical] = useState(false)
  const [qa, setQa] = useState(false)
  return <div className='p-4'>
    <div className='flex gap-2 my-4'>
      <Button onClick={() => setParentChild(!parentChild)}>
        Parent-Child
      </Button>
      <Button onClick={() => setVertical(!vertical)}>Vertical</Button>
      <Button onClick={() => setQa(!qa)}>QA</Button>
    </div>
    <PreviewContainer header={
      <PreviewHeader title='Preview'>
        <div className='flex items-center'>
          <FileIcon type='pdf' className='size-4' />
          <p
            className='text-text-primary text-sm font-semibold mx-1'
          >EOS R3 Tech Sheet.pdf</p>
          <ChevronDown className='size-[18px]' />
          <Badge text='276 Estimated chunks' className='ml-1' />
        </div>
      </PreviewHeader>
    }>
      <div className='space-y-6'>{parentChild
        ? Array.from({ length: 4 }, (_, i) => {
          return <ChunkContainer
            label='Parent-Chunk-01'
            characterCount={521}
            key={i}
          >
            <FormattedText className={classNames(
              'w-full',
              vertical && 'flex flex-col gap-2',
            )}>
              {Array.from({ length: 4 }, (_, i) => {
                return <PreviewSlice
                  key={i}
                  label='C-1'
                  text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
              })}
            </FormattedText>
          </ChunkContainer>
        })
        : Array.from({ length: 2 }, (_, i) => {
          return <ChunkContainer label='Chunk-01' characterCount={521} key={i}>
            {
              qa
                ? <QAPreview qa={{
                  question: 'What is the author\'s unconventional approach to writing this book, and how does it challenge the traditional academic mindset of \'publish or perish\'?',
                  answer: 'It is quite natural for academics who are continuously told to “publish or perish” to want to always create something from scratch that is their own fresh creation. This book is an experiment in not starting from scratch, but instead “re-mixing” the book titled Think Python: How to Think Like a Computer Scientist written by Allen B. Downey, Jeff Elkner and others.',
                }} />
                : 'In December of 2009, I was preparing to teach SI502 - Networked Programming at the University of Michigan for the fifth semester in a row and decided it was time to write a Python textbook that focused on exploring data instead of understanding algorithms and abstractions. My goal in SI502 is to teach people life-long data handling skills using Python. Few of my students were planning to be professional computer programmers. Instead, they planned be librarians, managers, lawyers, biologists, economists, etc. who happened to want to skillfully use technology in their chosen field.'
            }
          </ChunkContainer>
        })
      }</div>
      <DividerWithLabel label='Display previews of up to 10 paragraphs' />
    </PreviewContainer>
  </div>
}
