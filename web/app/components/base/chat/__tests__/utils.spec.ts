import type { IChatItem } from '../chat/type'
import { buildChatItemTree } from '../utils'
import branchedTestMessages from './branchedTestMessages.json'
import legacyTestMessages from './legacyTestMessages.json'
import mixedTestMessages from './mixedTestMessages.json'

describe('buildChatItemTree', () => {
  it('should build a tree from a list of chat items', () => {
    const tree1 = buildChatItemTree(branchedTestMessages as IChatItem[])
    expect(tree1).toMatchObject([{
      id: 'question-1',
      isAnswer: false,
      parentMessageId: null,
      siblingIndex: 0,
      children: [{
        id: '1',
        isAnswer: true,
        parentMessageId: 'question-1',
        siblingIndex: 0,
        children: [
          {
            id: 'question-2',
            isAnswer: false,
            parentMessageId: '1',
            siblingIndex: 0,
            children: [{
              id: '2',
              isAnswer: true,
              parentMessageId: 'question-2',
              siblingIndex: 0,
              children: [{
                id: 'question-3',
                isAnswer: false,
                parentMessageId: '2',
                siblingIndex: 0,
                children: [{
                  id: '3',
                  isAnswer: true,
                  parentMessageId: 'question-3',
                  siblingIndex: 0,
                  children: [],
                }],
              }],
            }],
          },
          {
            id: 'question-4',
            isAnswer: false,
            parentMessageId: '1',
            siblingIndex: 1,
            children: [{
              id: '4',
              isAnswer: true,
              parentMessageId: 'question-4',
              children: [],
            }],
          }],
      }],
    }])
  })

  it('should be compatible with legacy chat items', () => {
    const tree2 = buildChatItemTree(legacyTestMessages as IChatItem[])
    expect(tree2).toMatchObject([
      {
        id: 'question-1',
        isAnswer: false,
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        siblingIndex: 0,
        children: [
          {
            id: '1',
            isAnswer: true,
            parentMessageId: 'question-1',
            siblingIndex: 0,
            children: [
              {
                id: 'question-2',
                isAnswer: false,
                parentMessageId: '00000000-0000-0000-0000-000000000000',
                siblingIndex: 0,
                children: [
                  {
                    id: '2',
                    isAnswer: true,
                    parentMessageId: 'question-2',
                    siblingIndex: 0,
                    children: [
                      {
                        id: 'question-3',
                        isAnswer: false,
                        parentMessageId: '00000000-0000-0000-0000-000000000000',
                        siblingIndex: 0,
                        children: [
                          {
                            id: '3',
                            isAnswer: true,
                            parentMessageId: 'question-3',
                            siblingIndex: 0,
                            children: [
                              {
                                id: 'question-4',
                                isAnswer: false,
                                parentMessageId: '00000000-0000-0000-0000-000000000000',
                                siblingIndex: 0,
                                children: [
                                  {
                                    id: '4',
                                    isAnswer: true,
                                    parentMessageId: 'question-4',
                                    siblingIndex: 0,
                                    children: [],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
  })

  it('should build a tree from a list of mixed chat items', () => {
    const tree3 = buildChatItemTree(mixedTestMessages as IChatItem[])
    console.log(JSON.stringify(tree3, null, 2))

    // expect(tree3).toMatchObject([
    //   {
    //     id: 'question-1',
    //     isAnswer: false,
    //     parentMessageId: '00000000-0000-0000-0000-000000000000',
    //     siblingIndex: 0,
    //     children: [
    //       {
    //         id: '1',
    //         isAnswer: true,
    //         parentMessageId: 'question-1',
    //         siblingIndex: 0,
    //         children: [
    //           {
    //             id: 'question-2',
    //             isAnswer: false,
    //             parentMessageId: '00000000-0000-0000-0000-000000000000',
    //             siblingIndex: 0,
    //             children: [
    //               {
    //                 id: '2',
    //                 isAnswer: true,
    //                 parentMessageId: 'question-2',
    //                 siblingIndex: 0,
    //                 children: [
    //                   {
    //                     id: 'question-3',
    //                     isAnswer: false,
    //                     parentMessageId: '2',
    //                     siblingIndex: 0,
    //                     children: [
    //                       {
    //                         id: '3',
    //                         isAnswer: true,
    //                         parentMessageId: 'question-3',
    //                         siblingIndex: 0,
    //                         children: [],
    //                       },
    //                     ],
    //                   },
    //                 ],
    //               },
    //             ],
    //           },
    //           {
    //             id: 'question-4',
    //             isAnswer: false,
    //             parentMessageId: '1',
    //             siblingIndex: 1,
    //             children: [
    //               {
    //                 id: '4',
    //                 isAnswer: true,
    //                 parentMessageId: 'question-4',
    //                 siblingIndex: 0,
    //                 children: [],
    //               },
    //             ],
    //           },
    //         ],
    //       },
    //     ],
    //   },
    // ])
  })
})
