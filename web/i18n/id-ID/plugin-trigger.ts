const translation = {
  subscription: {
    title: 'Langganan',
    listNum: 'langganan {{num}}',
    empty: {
      title: 'Tidak ada langganan',
      button: 'Langganan baru',
    },
    createButton: {
      oauth: 'Langganan baru dengan OAuth',
      apiKey: 'Langganan baru dengan Kunci API',
      manual: 'Tempel URL untuk membuat langganan baru',
    },
    createSuccess: 'Langganan berhasil dibuat',
    createFailed: 'Gagal membuat langganan',
    maxCount: 'Maks {{num}} langganan',
    selectPlaceholder: 'Pilih langganan',
    noSubscriptionSelected: 'Belum memilih langganan',
    subscriptionRemoved: 'Langganan dihapus',
    list: {
      title: 'Langganan',
      addButton: 'Tambahkan',
      tip: 'Terima acara melalui Langganan',
      item: {
        enabled: 'Diaktifkan',
        disabled: 'Dinonaktifkan',
        credentialType: {
          api_key: 'Kunci API',
          oauth2: 'OAuth',
          unauthorized: 'Manual',
        },
        actions: {
          delete: 'Hapus',
          deleteConfirm: {
            title: 'Hapus {{name}}?',
            success: 'Langganan {{name}} berhasil dihapus',
            error: 'Gagal menghapus langganan {{name}}',
            content: 'Setelah dihapus, langganan ini tidak dapat dikembalikan. Harap konfirmasi.',
            contentWithApps: 'Langganan saat ini direferensikan oleh {{count}} aplikasi. Menghapusnya akan menyebabkan aplikasi yang dikonfigurasi berhenti menerima acara langganan.',
            confirm: 'Konfirmasi Hapus',
            cancel: 'Batal',
            confirmInputWarning: 'Silakan masukkan nama yang benar untuk konfirmasi.',
            confirmInputPlaceholder: 'Masukkan "{{name}}" untuk konfirmasi.',
            confirmInputTip: 'Silakan masukkan “{{name}}” untuk mengonfirmasi.',
          },
        },
        status: {
          active: 'Aktif',
          inactive: 'Tidak aktif',
        },
        usedByNum: 'Digunakan oleh {{num}} alur kerja',
        noUsed: 'Tidak ada alur kerja yang digunakan',
      },
    },
    addType: {
      title: 'Tambah langganan',
      description: 'Pilih bagaimana Anda ingin membuat langganan pemicu Anda',
      options: {
        apikey: {
          title: 'Buat dengan Kunci API',
          description: 'Buat langganan secara otomatis menggunakan kredensial API',
        },
        oauth: {
          title: 'Buat dengan OAuth',
          description: 'Otorisasi dengan platform pihak ketiga untuk membuat langganan',
          clientSettings: 'Pengaturan Klien OAuth',
          clientTitle: 'Klien OAuth',
          default: 'Default',
          custom: 'Kustom',
        },
        manual: {
          title: 'Pengaturan Manual',
          description: 'Tempel URL untuk membuat langganan baru',
          tip: 'Konfigurasikan URL di platform pihak ketiga secara manual',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Verifikasi',
      configuration: 'Konfigurasi',
    },
    common: {
      cancel: 'Batal',
      back: 'Kembali',
      next: 'Berikutnya',
      create: 'Buat',
      verify: 'Verifikasi',
      authorize: 'Otorisasi',
      creating: 'Membuat...',
      verifying: 'Memverifikasi...',
      authorizing: 'Mengizinkan...',
    },
    oauthRedirectInfo: 'Karena tidak ditemukan rahasia klien sistem untuk penyedia alat ini, pengaturannya harus dilakukan secara manual, untuk redirect_uri, silakan gunakan',
    apiKey: {
      title: 'Buat dengan Kunci API',
      verify: {
        title: 'Verifikasi Kredensial',
        description: 'Silakan berikan kredensial API Anda untuk memverifikasi akses',
        error: 'Verifikasi kredensial gagal. Silakan periksa kunci API Anda.',
        success: 'Kredensial berhasil diverifikasi',
      },
      configuration: {
        title: 'Atur Langganan',
        description: 'Atur parameter langganan Anda',
      },
    },
    oauth: {
      title: 'Buat dengan OAuth',
      authorization: {
        title: 'Otorisasi OAuth',
        description: 'Izinkan Dify untuk mengakses akun Anda',
        redirectUrl: 'URL Pengalihan',
        redirectUrlHelp: 'Gunakan URL ini dalam konfigurasi aplikasi OAuth Anda',
        authorizeButton: 'Otorisasi dengan {{provider}}',
        waitingAuth: 'Menunggu otorisasi...',
        authSuccess: 'Otorisasi berhasil',
        authFailed: 'Gagal mendapatkan informasi otorisasi OAuth',
        waitingJump: 'Diizinkan, menunggu lompatan',
      },
      configuration: {
        title: 'Atur Langganan',
        description: 'Atur parameter langganan Anda setelah otorisasi',
        success: 'Konfigurasi OAuth berhasil',
        failed: 'Konfigurasi OAuth gagal',
      },
      remove: {
        success: 'Penghapusan OAuth berhasil',
        failed: 'Gagal menghapus OAuth',
      },
      save: {
        success: 'Konfigurasi OAuth berhasil disimpan',
      },
    },
    manual: {
      title: 'Pengaturan Manual',
      description: 'Konfigurasikan langganan webhook Anda secara manual',
      logs: {
        title: 'Catatan Permintaan',
        request: 'Permintaan',
        loading: 'Menunggu permintaan dari {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Nama Langganan',
        placeholder: 'Masukkan nama langganan',
        required: 'Nama langganan wajib diisi',
      },
      callbackUrl: {
        label: 'URL Panggilan Balik',
        description: 'URL ini akan menerima event webhook',
        tooltip: 'Sediakan endpoint yang dapat diakses publik yang dapat menerima permintaan callback dari penyedia pemicu.',
        placeholder: 'Sedang menghasilkan...',
        privateAddressWarning: 'URL ini tampaknya merupakan alamat internal, yang mungkin menyebabkan permintaan webhook gagal. Anda dapat mengubah TRIGGER_URL ke alamat publik.',
      },
    },
    errors: {
      createFailed: 'Gagal membuat langganan',
      verifyFailed: 'Gagal memverifikasi kredensial',
      authFailed: 'Otorisasi gagal',
      networkError: 'Kesalahan jaringan, silakan coba lagi',
    },
  },
  events: {
    title: 'Acara Tersedia',
    description: 'Peristiwa yang dapat diikuti oleh plugin pemicu ini',
    empty: 'Tidak ada acara tersedia',
    event: 'Acara',
    events: 'Acara',
    actionNum: '{{num}} {{event}} TERMASUK',
    item: {
      parameters: 'parameter {{count}}',
      noParameters: 'Tidak ada parameter',
    },
    output: 'Keluaran',
  },
  node: {
    status: {
      warning: 'Putuskan sambungan',
    },
  },
}

export default translation
