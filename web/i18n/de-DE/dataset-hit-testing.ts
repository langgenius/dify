const translation = {
  title: 'Abruf-Test',
  desc: 'Testen Sie die Treffereffektivität des Wissens anhand des gegebenen Abfragetextes.',
  dateTimeFormat: 'MM/DD/YYYY hh:mm A',
  table: {
    header: {
      source: 'Quelle',
      time: 'Zeit',
      queryContent: 'Inhaltsabfrage',
    },
  },
  input: {
    title: 'Quelltext',
    placeholder: 'Bitte geben Sie einen Text ein, ein kurzer aussagekräftiger Satz wird empfohlen.',
    countWarning: 'Bis zu 200 Zeichen.',
    indexWarning: 'Nur Wissen hoher Qualität.',
    testing: 'Testen',
  },
  hit: {
    title: 'ABRUFPARAGRAFEN',
    emptyTip: 'Ergebnisse des Abruf-Tests werden hier angezeigt',
  },
  noRecentTip: 'Keine kürzlichen Abfrageergebnisse hier',
  viewChart: 'VEKTORDIAGRAMM ansehen',
  viewDetail: 'Im Detail sehen',
  settingTitle: 'Einstellung für den Abruf',
  records: 'Aufzeichnungen',
  open: 'Offen',
  hitChunks: 'Klicken Sie auf {{num}} untergeordnete Chunks',
  keyword: 'Schlüsselwörter',
  chunkDetail: 'Chunk-Detail',
  imageUploader: {
    tip: 'Bilder hochladen oder ablegen (Max. {{batchCount}}, {{size}} MB pro Bild)',
    tooltip: 'Bilder hochladen (Max. {{batchCount}}, jeweils {{size}} MB)',
    dropZoneTip: 'Datei hierher ziehen, um sie hochzuladen',
    singleChunkAttachmentLimitTooltip: 'Die Anzahl der Einzelblock-Anhänge darf {{limit}} nicht überschreiten',
  },
}

export default translation
