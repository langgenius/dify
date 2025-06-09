const translation = {
  common: {
    welcome: '',
    appUnavailable: 'App ist nicht verfügbar',
    appUnknownError: 'App ist nicht verfügbar',
  },
  chat: {
    newChat: 'Neuer Chat',
    pinnedTitle: 'Angeheftet',
    unpinnedTitle: 'Chats',
    newChatDefaultName: 'Neues Gespräch',
    resetChat: 'Gespräch zurücksetzen',
    poweredBy: 'Bereitgestellt von',
    prompt: 'Aufforderung',
    privatePromptConfigTitle: 'Konversationseinstellungen',
    publicPromptConfigTitle: 'Anfängliche Aufforderung',
    configStatusDes: 'Vor dem Start können Sie die Konversationseinstellungen ändern',
    configDisabled:
      'Voreinstellungen der vorherigen Sitzung wurden für diese Sitzung verwendet.',
    startChat: 'Chat starten',
    privacyPolicyLeft:
      'Bitte lesen Sie die ',
    privacyPolicyMiddle:
      'Datenschutzrichtlinien',
    privacyPolicyRight:
      ', die vom App-Entwickler bereitgestellt wurden.',
    deleteConversation: {
      title: 'Konversation löschen',
      content: 'Sind Sie sicher, dass Sie diese Konversation löschen möchten?',
    },
    tryToSolve: 'Versuchen zu lösen',
    temporarySystemIssue: 'Entschuldigung, vorübergehendes Systemproblem.',
    expand: 'Erweitern',
    collapse: 'Reduzieren',
    chatSettingsTitle: 'Neues Chat-Setup',
    newChatTip: 'Bereits in einem neuen Chat',
    viewChatSettings: 'Chateinstellungen anzeigen',
    chatFormTip: 'Chat-Einstellungen können nach Beginn des Chats nicht mehr geändert werden.',
  },
  generation: {
    tabs: {
      create: 'Einmal ausführen',
      batch: 'Stapelverarbeitung',
      saved: 'Gespeichert',
    },
    savedNoData: {
      title: 'Sie haben noch kein Ergebnis gespeichert!',
      description: 'Beginnen Sie mit der Inhaltserstellung und finden Sie hier Ihre gespeicherten Ergebnisse.',
      startCreateContent: 'Beginnen Sie mit der Inhaltserstellung',
    },
    title: 'KI-Vervollständigung',
    queryTitle: 'Abfrageinhalt',
    completionResult: 'Vervollständigungsergebnis',
    queryPlaceholder: 'Schreiben Sie Ihren Abfrageinhalt...',
    run: 'Ausführen',
    copy: 'Kopieren',
    resultTitle: 'KI-Vervollständigung',
    noData: 'KI wird Ihnen hier geben, was Sie möchten.',
    csvUploadTitle: 'Ziehen Sie Ihre CSV-Datei hierher oder ',
    browse: 'durchsuchen',
    csvStructureTitle: 'Die CSV-Datei muss der folgenden Struktur entsprechen:',
    downloadTemplate: 'Laden Sie die Vorlage hier herunter',
    field: 'Feld',
    batchFailed: {
      info: '{{num}} fehlgeschlagene Ausführungen',
      retry: 'Wiederholen',
      outputPlaceholder: 'Kein Ausgabeanhalt',
    },
    errorMsg: {
      empty: 'Bitte geben Sie Inhalte in die hochgeladene Datei ein.',
      fileStructNotMatch: 'Die hochgeladene CSV-Datei entspricht nicht der Struktur.',
      emptyLine: 'Zeile {{rowIndex}} ist leer',
      invalidLine: 'Zeile {{rowIndex}}: {{varName}} Wert darf nicht leer sein',
      moreThanMaxLengthLine: 'Zeile {{rowIndex}}: {{varName}} Wert darf nicht mehr als {{maxLength}} Zeichen sein',
      atLeastOne: 'Bitte geben Sie mindestens eine Zeile in die hochgeladene Datei ein.',
    },
    executions: '{{num}} HINRICHTUNGEN',
    execution: 'AUSFÜHRUNG',
  },
  login: {
    backToHome: 'Zurück zur Startseite',
  },
}

export default translation
