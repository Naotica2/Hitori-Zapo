/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * config.js — Centralized configuration untuk Hitori-MD
 */

export default {
  botName: 'Hitori-MD',

  auth: {
    method: 'qr',
    customCode: 'H1TR1MD8', // 8 karakter dari 1-9 & A-Z tanpa I, O, U, 0
    useCustomCode: true,
    pairingNumber: ''
  },

  prefixes: ['.', '!', '/', '#', ',', '😁', '🦅'],
  mainPrefix: '.',

  // Tambahkan nomor/LID owner & staff bot di sini.
  // Contoh:
  // { number: '628xxxxxxxxxx', role: 'owner', label: 'Owner' },
  // { number: '628xxxxxxxxxx', lid: '123456789012345', role: 'admin', label: 'Staff Admin' },
  staff: [
    { number: '6285794044267', role: 'owner', label: 'Naoticaa' },
  ],

  // Fitur grup yang butuh on/off (permission admin/staff)
  toggleable: ['welcome', 'bye', 'antilink', 'game', 'wrapped', 'autogempa'],

  // BLACKLIST domain antilink (default; bisa di-override per grup).
  // Selain daftar ini = boleh. Yang di daftar = dihapus.
  antilink: {
    defaultBlacklist: 'wa.me,chat.whatsapp.com,t.me,telegram.me'
  },

  sticker: {
    packName: 'Made with',
    author: 'Hitori-MD',
    withExif: true,
    maxVideoSeconds: 10
  },

  wsWorkerUrl: 'wss://audio.jhx.my.id/wss/audio',
  wsPort: 8090,
  wsPath: '/wss/audio',

  antiSpam: {
    enabled: true,
    max: 5,
    windowMs: 10_000,
    muteMs: 30_000
  },
  cooldown: 3000,

  autoRead: true,
  typingPresence: true,

  // Hot Reload — auto reload command di feat/ tiap ada file baru/edit/hapus.
  hotReload: {
    enabled: true,
    debounceMs: 400,
    notifyOwner: true
  },

  // React Channel — auto-react postingan baru di channel khusus bot,
  // + command .rch buat react manual ke postingan channel manapun.
  // Isi dedicatedChannelUrl dengan link saluran WhatsApp milikmu & ubah enabled: true untuk mengaktifkan.
  reactChannel: {
    enabled: false,
    dedicatedChannelUrl: '',
    emojis: ['🔥', '❤️', '😍', '👍', '😂', '🥳', '💯', '✨']
  },

  messages: {
    wait: '⏳ Tunggu sebentar ya, Kak...',
    error: '😵 Terjadi kesalahan, harap coba kembali nanti',
    ownerOnly: '🚫 Fitur ini khusus OWNER!',
    adminOnly: '🚫 Fitur ini khusus ADMIN!',
    groupOnly: '🚫 Fitur ini khusus GRUP!'
  },

  logLevel: 'info',
  libraryLogLevel: 'error'
}
