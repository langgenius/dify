const translation = {
  subscription: {
    title: 'Abonelikler',
    listNum: '{{num}} abonelikler',
    empty: {
      title: 'Abonelik yok',
      button: 'Yeni abonelik',
    },
    createButton: {
      oauth: 'OAuth ile yeni abonelik',
      apiKey: 'API Anahtarı ile yeni abonelik',
      manual: 'Yeni bir abonelik oluşturmak için URL\'yi yapıştırın',
    },
    createSuccess: 'Abonelik başarıyla oluşturuldu',
    createFailed: 'Abonelik oluşturulamadı',
    maxCount: 'Maksimum {{num}} abonelik',
    selectPlaceholder: 'Abonelik seç',
    noSubscriptionSelected: 'Hiçbir abonelik seçilmedi',
    subscriptionRemoved: 'Abonelik kaldırıldı',
    list: {
      title: 'Abonelikler',
      addButton: 'Ekle',
      tip: 'Abonelik aracılığıyla etkinlikleri alın',
      item: {
        enabled: 'Etkin',
        disabled: 'Devre Dışı',
        credentialType: {
          api_key: 'API Anahtarı',
          oauth2: 'OAuth',
          unauthorized: 'Kılavuz',
        },
        actions: {
          delete: 'Sil',
          deleteConfirm: {
            title: '{{name}} silinsin mi?',
            success: 'Abonelik {{name}} başarıyla silindi',
            error: 'Abonelik {{name}} silinemedi',
            content: 'Bir kez silindiğinde, bu abonelik kurtarılamaz. Lütfen onaylayın.',
            contentWithApps: 'Mevcut abonelik {{count}} uygulama tarafından referans gösterilmektedir. Bunu silmek, yapılandırılmış uygulamaların abonelik olaylarını almamasına neden olacaktır.',
            confirm: 'Silmeyi Onayla',
            cancel: 'İptal',
            confirmInputWarning: 'Onaylamak için lütfen doğru adı girin.',
            confirmInputPlaceholder: '"{{name}}" yazın ve onaylayın.',
            confirmInputTip: 'Lütfen onaylamak için “{{name}}” girin.',
          },
        },
        status: {
          active: 'Aktif',
          inactive: 'Etkin değil',
        },
        usedByNum: '{{num}} iş akışı tarafından kullanılıyor',
        noUsed: 'Hiç işlem akışı kullanılmadı',
      },
    },
    addType: {
      title: 'Abonelik ekle',
      description: 'Tetikleyici aboneliğinizi nasıl oluşturmak istediğinizi seçin',
      options: {
        apikey: {
          title: 'API Anahtarı ile Oluştur',
          description: 'API kimlik bilgilerini kullanarak otomatik olarak abonelik oluştur',
        },
        oauth: {
          title: 'OAuth ile oluştur',
          description: 'Abonelik oluşturmak için üçüncü taraf platformla yetkilendirme yap',
          clientSettings: 'OAuth İstemci Ayarları',
          clientTitle: 'OAuth İstemcisi',
          default: 'Varsayılan',
          custom: 'Özel',
        },
        manual: {
          title: 'Manuel Kurulum',
          description: 'Yeni bir abonelik oluşturmak için URL\'yi yapıştırın',
          tip: 'URL\'yi üçüncü taraf platformda manuel olarak yapılandır',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Doğrula',
      configuration: 'Yapılandırma',
    },
    common: {
      cancel: 'İptal',
      back: 'Geri',
      next: 'Sonraki',
      create: 'Oluştur',
      verify: 'Doğrula',
      authorize: 'Yetkilendir',
      creating: 'Oluşturuluyor...',
      verifying: 'Doğrulanıyor...',
      authorizing: 'Yetkilendiriliyor...',
    },
    oauthRedirectInfo: 'Bu araç sağlayıcı için sistem istemci gizli anahtarları bulunamadığından, yönlendirme_uri için manuel olarak ayarlamanız gerekmektedir, lütfen kullanın',
    apiKey: {
      title: 'API Anahtarı ile Oluştur',
      verify: {
        title: 'Kimlik Bilgilerini Doğrula',
        description: 'Erişimi doğrulamak için lütfen API kimlik bilgilerinizi sağlayın',
        error: 'Kimlik doğrulama başarısız oldu. Lütfen API anahtarınızı kontrol edin.',
        success: 'Kimlik bilgileri başarıyla doğrulandı',
      },
      configuration: {
        title: 'Aboneliği Yapılandır',
        description: 'Abonelik parametrelerinizi ayarlayın',
      },
    },
    oauth: {
      title: 'OAuth ile oluştur',
      authorization: {
        title: 'OAuth Yetkilendirmesi',
        description: 'Dify\'nin hesabınıza erişmesine izin verin',
        redirectUrl: 'Yönlendirme URL\'si',
        redirectUrlHelp: 'Bu URL\'yi OAuth uygulama yapılandırmanızda kullanın',
        authorizeButton: '{{provider}} ile yetkilendir',
        waitingAuth: 'Yetkilendirme bekleniyor...',
        authSuccess: 'Yetkilendirme başarılı',
        authFailed: 'OAuth yetkilendirme bilgileri alınamadı',
        waitingJump: 'Yetkili, atlama için bekliyor',
      },
      configuration: {
        title: 'Aboneliği Yapılandır',
        description: 'Yetkilendirmeden sonra abonelik parametrelerinizi ayarlayın',
        success: 'OAuth yapılandırması başarılı',
        failed: 'OAuth yapılandırması başarısız oldu',
      },
      remove: {
        success: 'OAuth kaldırma başarılı',
        failed: 'OAuth kaldırma başarısız oldu',
      },
      save: {
        success: 'OAuth yapılandırması başarıyla kaydedildi',
      },
    },
    manual: {
      title: 'Manuel Kurulum',
      description: 'Webhook aboneliğinizi manuel olarak yapılandırın',
      logs: {
        title: 'İstek Kayıtları',
        request: 'Talep',
        loading: '{{pluginName}}\'dan istek bekleniyor...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Abonelik Adı',
        placeholder: 'Abonelik adını girin',
        required: 'Abonelik adı gereklidir',
      },
      callbackUrl: {
        label: 'Geri Arama URL\'si',
        description: 'Bu URL webhook olaylarını alacaktır',
        tooltip: 'Tetikleyici sağlayıcısından geri arama istekleri alabilecek genel erişime açık bir uç nokta sağlayın.',
        placeholder: 'Oluşturuluyor...',
        privateAddressWarning: 'Bu URL dahili bir adres gibi görünüyor ve bu, webhook isteklerinin başarısız olmasına neden olabilir. TRIGGER_URL\'i halka açık bir adresle değiştirebilirsiniz.',
      },
    },
    errors: {
      createFailed: 'Abonelik oluşturulamadı',
      verifyFailed: 'Kimlik bilgileri doğrulanamadı',
      authFailed: 'Yetkilendirme başarısız',
      networkError: 'Ağ hatası, lütfen tekrar deneyin',
    },
  },
  events: {
    title: 'Mevcut Etkinlikler',
    description: 'Bu tetikleyici eklentisinin abone olabileceği etkinlikler',
    empty: 'Hiç etkinlik yok',
    event: 'Etkinlik',
    events: 'Etkinlikler',
    actionNum: '{{num}} {{event}} DAHİL',
    item: {
      parameters: '{{count}} parametreleri',
      noParameters: 'Parametre yok',
    },
    output: 'Çıktı',
  },
  node: {
    status: {
      warning: 'Bağlantıyı kes',
    },
  },
}

export default translation
