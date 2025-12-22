const translation = {
  title: 'Retrieval Test',
  settingTitle: 'Retrieval Setting',
  desc: 'Test the hitting effect of the Knowledge based on the given query text.',
  dateTimeFormat: 'MM/DD/YYYY hh:mm A',
  records: 'Records',
  table: {
    header: {
      source: 'Source',
      queryContent: 'Query Content',
      time: 'Time',
    },
  },
  input: {
    title: 'Source text',
    placeholder: 'Please enter a text, a short declarative sentence is recommended.',
    countWarning: 'Up to 200 characters.',
    indexWarning: 'High quality Knowledge only.',
    testing: 'Test',
  },
  hit: {
    title: '{{num}} Retrieved Chunks',
    emptyTip: 'Retrieval Testing results will show here',
  },
  noRecentTip: 'No recent query results here',
  viewChart: 'View VECTOR CHART',
  viewDetail: 'View Detail',
  chunkDetail: 'Chunk Detail',
  hitChunks: 'Hit {{num}} child chunks',
  open: 'Open',
  keyword: 'Keywords',
  imageUploader: {
    tip: 'Upload or drop images (Max {{batchCount}}, {{size}}MB each)',
    tooltip: 'Upload images (Max {{batchCount}}, {{size}}MB each)',
    dropZoneTip: 'Drag file here to upload',
    singleChunkAttachmentLimitTooltip: 'The number of single chunk attachments cannot exceed {{limit}}',
  },
}

export default translation
