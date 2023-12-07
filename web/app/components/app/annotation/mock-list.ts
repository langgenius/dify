import type { AnnotationItem } from './type'

const list: AnnotationItem[] = [
  // create some mock data
  {
    id: '1',
    question: 'What is the capital of the United States?',
    answer: 'Washington, D.C.',
    created_at: '2020-01-01T00:00:00Z',
    hit_count: 1,
  },
  {
    id: '2',
    question: 'What is the capital of Canada?',
    answer: 'Ottawa',
    created_at: '2020-01-02T00:00:00Z',
    hit_count: 2,
  },
  {
    id: '3',
    question: 'What is the capital of Mexico?',
    answer: 'Mexico City',
    created_at: '2020-01-03T00:00:00Z',
    hit_count: 3,
  },
  {
    id: '4',
    question: 'What is the capital of Brazil?',
    answer: 'Brasilia',
    created_at: '2020-01-04T00:00:00Z',
    hit_count: 4,
  },
  {
    id: '5',
    question: 'What is the capital of Argentina?',
    answer: 'Buenos Aires',
    created_at: '2020-01-05T00:00:00Z',
    hit_count: 5,
  },
  {
    id: '6',
    question: 'What is the capital of Chile?',
    answer: 'Santiago',
    created_at: '2020-01-06T00:00:00Z',
    hit_count: 6,
  },
  {
    id: '7',
    question: 'What is the capital of Peru?',
    answer: 'Lima',
    created_at: '2020-01-07T00:00:00Z',
    hit_count: 7,
  },
  {
    id: '8',
    question: 'What is the capital of Ecuador?',
    answer: 'Quito',
    created_at: '2020-01-08T00:00:00Z',
    hit_count: 8,
  },
  {
    id: '9',
    question: 'What is the capital of Colombia?',
    answer: 'Bogota',
    created_at: '2020-01-09T00:00:00Z',
    hit_count: 9,
  },
]

export default list
