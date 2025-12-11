const translation = {
  title: '検索テスト',
  desc: '与えられたクエリテキストに基づいたナレッジのヒット効果をテストします。',
  dateTimeFormat: 'YYYY/MM/DD hh:mm A',
  records: '記録',
  table: {
    header: {
      source: 'ソース',
      queryContent: 'クエリ内容',
      time: '時間',
    },
  },
  input: {
    title: 'ソーステキスト',
    placeholder: 'テキストを入力してください。短い記述文がおすすめです。',
    countWarning: '最大 200 文字まで入力できます。',
    indexWarning: '高品質のナレッジのみ。',
    testing: 'テスト',
  },
  hit: {
    title: '取得したチャンク{{num}}個',
    emptyTip: '検索テストの結果がここに表示されます。',
  },
  noRecentTip: '最近のクエリ結果はありません。',
  viewChart: 'ベクトルチャートを表示',
  settingTitle: '検索設定',
  viewDetail: '詳細を表示',
  chunkDetail: 'チャンクの詳細',
  hitChunks: '{{num}}個の子チャンクをヒット',
  open: '開く',
  keyword: 'キーワード',
  imageUploader: {
    tip: '画像をアップロードまたはドラッグ＆ドロップしてください（最大 {{batchCount}} 件、各 {{size}}MB まで）',
    tooltip: '画像をアップロード（最大 {{batchCount}} 件、各 {{size}}MB まで）',
    dropZoneTip: 'ファイルをここにドラッグしてアップロード',
    singleChunkAttachmentLimitTooltip: '単一チャンクの添付ファイルの数は {{limit}} を超えることはできません',
  },
}

export default translation
