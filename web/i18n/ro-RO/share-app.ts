const translation = {
  common: {
    welcome: '',
    appUnavailable: 'Aplicația nu este disponibilă',
    appUnknownError: 'Aplicația nu este disponibilă',
  },
  chat: {
    newChat: 'Chat nou',
    pinnedTitle: 'Fixat',
    unpinnedTitle: 'Conversații',
    newChatDefaultName: 'Conversație nouă',
    resetChat: 'Resetează conversația',
    poweredBy: 'Furnizat de',
    prompt: 'Sugestie',
    privatePromptConfigTitle: 'Setări conversație',
    publicPromptConfigTitle: 'Sugestie inițială',
    configStatusDes: 'Înainte de a începe, puteți modifica setările conversației',
    configDisabled:
      'Setările sesiunii anterioare au fost utilizate pentru această sesiune.',
    startChat: 'Începe chat',
    privacyPolicyLeft:
      'Vă rugăm să citiți ',
    privacyPolicyMiddle:
      'politica de confidențialitate',
    privacyPolicyRight:
      ' furnizată de dezvoltatorul aplicației.',
    deleteConversation: {
      title: 'Șterge conversația',
      content: 'Sigur doriți să ștergeți această conversație?',
    },
    tryToSolve: 'Încercați să rezolvați',
    temporarySystemIssue: 'Ne pare rău, problemă temporară a sistemului.',
  },
  generation: {
    tabs: {
      create: 'Rulează o singură dată',
      batch: 'Rulează în lot',
      saved: 'Salvat',
    },
    savedNoData: {
      title: 'Nu ați salvat încă un rezultat!',
      description: 'Începeți generarea de conținut și găsiți aici rezultatele salvate.',
      startCreateContent: 'Începeți crearea de conținut',
    },
    title: 'Completare AI',
    queryTitle: 'Conținutul interogării',
    completionResult: 'Rezultatul completării',
    queryPlaceholder: 'Scrieți conținutul interogării...',
    run: 'Execută',
    copy: 'Copiază',
    resultTitle: 'Completare AI',
    noData: 'AI vă va oferi ceea ce doriți aici.',
    csvUploadTitle: 'Trageți și plasați fișierul CSV aici sau ',
    browse: 'răsfoiți',
    csvStructureTitle: 'Fișierul CSV trebuie să respecte următoarea structură:',
    downloadTemplate: 'Descărcați șablonul aici',
    field: 'Câmp',
    batchFailed: {
      info: '{{num}} execuții eșuate',
      retry: 'Reîncercați',
      outputPlaceholder: 'Niciun conținut de ieșire',
    },
    errorMsg: {
      empty: 'Vă rugăm să introduceți conținut în fișierul încărcat.',
      fileStructNotMatch: 'Fișierul CSV încărcat nu se potrivește cu structura.',
      emptyLine: 'Rândul {{rowIndex}} este gol',
      invalidLine: 'Rândul {{rowIndex}}: valoarea {{varName}} nu poate fi goală',
      moreThanMaxLengthLine: 'Rândul {{rowIndex}}: valoarea {{varName}} nu poate avea mai mult de {{maxLength}} caractere',
      atLeastOne: 'Vă rugăm să introduceți cel puțin un rând în fișierul încărcat.',
    },
  },
}

export default translation
