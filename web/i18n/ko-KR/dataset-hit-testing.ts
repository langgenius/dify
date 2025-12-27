const translation = {
  title: '검색 테스트',
  desc: '주어진 쿼리 텍스트에 기반하여 지식의 검색 효과를 테스트합니다.',
  dateTimeFormat: 'YYYY-MM-DD HH:mm',
  table: {
    header: {
      source: '소스',
      time: '시간',
      queryContent: '쿼리 내용',
    },
  },
  input: {
    title: '소스 텍스트',
    placeholder: '텍스트를 입력하세요. 간결한 서술문이 좋습니다.',
    countWarning: '최대 200자까지 입력할 수 있습니다.',
    indexWarning: '고품질 지식만 지원합니다.',
    testing: '테스트 중',
  },
  hit: {
    title: '검색 결과',
    emptyTip: '검색 테스트 결과가 여기에 표시됩니다.',
  },
  noRecentTip: '최근 쿼리 결과가 없습니다.',
  viewChart: '벡터 차트 보기',
  settingTitle: '검색 설정',
  viewDetail: '상세 보기',
  open: '열기',
  records: '기록',
  hitChunks: '{{num}}개의 자식 청크 검색됨',
  keyword: '키워드',
  chunkDetail: '청크 상세',
  imageUploader: {
    tip: '이미지를 업로드하거나 드래그하세요 (최대 {{batchCount}}장, 장당 {{size}}MB)',
    tooltip: '이미지 업로드 (최대 {{batchCount}}장, 장당 {{size}}MB)',
    dropZoneTip: '업로드할 파일을 여기에 끌어놓으세요',
    singleChunkAttachmentLimitTooltip: '단일 청크 첨부 파일 수는 {{limit}}개를 초과할 수 없습니다',
  },
}

export default translation