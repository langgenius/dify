const translation = {
  title: 'Wissenseinstellungen',
  desc: 'Hier können Sie die Eigenschaften und Arbeitsweisen des Wissens anpassen.',
  form: {
    name: 'Wissensname',
    namePlaceholder: 'Bitte geben Sie den Namen des Wissens ein',
    nameError: 'Name darf nicht leer sein',
    desc: 'Wissensbeschreibung',
    descInfo: 'Bitte schreiben Sie eine klare textuelle Beschreibung, um den Inhalt des Wissens zu umreißen. Diese Beschreibung wird als Grundlage für die Auswahl aus mehreren Wissensdatenbanken zur Inferenz verwendet.',
    descPlaceholder: 'Beschreiben Sie, was in diesem Wissen enthalten ist. Eine detaillierte Beschreibung ermöglicht es der KI, zeitnah auf den Inhalt des Wissens zuzugreifen. Wenn leer, verwendet Dify die Standard-Treffstrategie.',
    descWrite: 'Erfahren Sie, wie man eine gute Wissensbeschreibung schreibt.',
    permissions: 'Berechtigungen',
    permissionsOnlyMe: 'Nur ich',
    permissionsAllMember: 'Alle Teammitglieder',
    indexMethod: 'Indexierungsmethode',
    indexMethodHighQuality: 'Hohe Qualität',
    indexMethodHighQualityTip: 'Den Embedding-Modell zur Verarbeitung aufrufen, um bei Benutzeranfragen eine höhere Genauigkeit zu bieten.',
    indexMethodEconomy: 'Ökonomisch',
    indexMethodEconomyTip: 'Verwendet Offline-Vektor-Engines, Schlagwortindizes usw., um die Genauigkeit ohne Tokenverbrauch zu reduzieren',
    embeddingModel: 'Einbettungsmodell',
    embeddingModelTip: 'Ändern Sie das eingebettete Modell, bitte gehen Sie zu ',
    embeddingModelTipLink: 'Einstellungen',
    retrievalSetting: {
      title: 'Abrufeinstellung',
      learnMore: 'Mehr erfahren',
      description: ' über die Abrufmethode.',
      longDescription: ' über die Abrufmethode, dies kann jederzeit in den Wissenseinstellungen geändert werden.',
    },
    save: 'Speichern',
  },
}

export default translation
