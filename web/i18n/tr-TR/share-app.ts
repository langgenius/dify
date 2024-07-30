const translation = {
  common: {
    welcome: '',
    appUnavailable: 'Uygulama kullanılamıyor',
    appUnkonwError: 'Uygulama kullanılamıyor',
  },
  chat: {
    newChat: 'Yeni sohbet',
    pinnedTitle: 'Sabitlenmiş',
    unpinnedTitle: 'Sohbetler',
    newChatDefaultName: 'Yeni konuşma',
    resetChat: 'Konuşmayı sıfırla',
    powerBy: 'Destekleyen',
    prompt: 'İstem',
    privatePromptConfigTitle: 'Konuşma ayarları',
    publicPromptConfigTitle: 'Başlangıç İstemi',
    configStatusDes: 'Başlamadan önce, konuşma ayarlarını değiştirebilirsiniz',
    configDisabled:
      'Bu oturum için önceki oturum ayarları kullanılmıştır.',
    startChat: 'Sohbeti Başlat',
    privacyPolicyLeft:
      'Lütfen uygulama geliştiricisi tarafından sağlanan ',
    privacyPolicyMiddle:
      'gizlilik politikasını',
    privacyPolicyRight:
      ' okuyun.',
    deleteConversation: {
      title: 'Konuşmayı sil',
      content: 'Bu konuşmayı silmek istediğinizden emin misiniz?',
    },
    tryToSolve: 'Çözmeye çalış',
    temporarySystemIssue: 'Üzgünüz, geçici sistem sorunu.',
  },
  generation: {
    tabs: {
      create: 'Bir Kez Çalıştır',
      batch: 'Toplu Çalıştır',
      saved: 'Kaydedilmiş',
    },
    savedNoData: {
      title: 'Henüz bir sonuç kaydetmediniz!',
      description: 'İçerik oluşturmaya başlayın ve kaydedilmiş sonuçlarınızı burada bulun.',
      startCreateContent: 'İçerik oluşturmaya başla',
    },
    title: 'AI Tamamlama',
    queryTitle: 'Sorgu içeriği',
    completionResult: 'Tamamlama sonucu',
    queryPlaceholder: 'Sorgu içeriğinizi yazın...',
    run: 'Çalıştır',
    copy: 'Kopyala',
    resultTitle: 'AI Tamamlama',
    noData: 'AI istediğinizi burada verecek.',
    csvUploadTitle: 'CSV dosyanızı buraya sürükleyip bırakın veya ',
    browse: 'gözatın',
    csvStructureTitle: 'CSV dosyası aşağıdaki yapıya uygun olmalıdır:',
    downloadTemplate: 'Şablonu buradan indirin',
    field: 'Alan',
    batchFailed: {
      info: '{{num}} başarısız çalıştırma',
      retry: 'Tekrar dene',
      outputPlaceholder: 'Çıktı içeriği yok',
    },
    errorMsg: {
      empty: 'Lütfen yüklenen dosyaya içerik girin.',
      fileStructNotMatch: 'Yüklenen CSV dosyası yapıyla eşleşmiyor.',
      emptyLine: 'Satır {{rowIndex}} boş',
      invalidLine: 'Satır {{rowIndex}}: {{varName}} değeri boş olamaz',
      moreThanMaxLengthLine: 'Satır {{rowIndex}}: {{varName}} değeri {{maxLength}} karakterden fazla olamaz',
      atLeastOne: 'Lütfen yüklenen dosyaya en az bir satır girin.',
    },
  },
}

export default translation
