/**
 * Bot WhatsApp - Backup nomor member grup (TANPA admin)
 *
 * Cara pakai:
 *   1. npm install
 *   2. npm start            -> scan QR (WhatsApp > Perangkat tertaut > Tautkan perangkat)
 *      atau: npm start -- 628xxxxxxxxxx   -> login pakai kode pairing
 *   3. Buka chat "Message yourself" / chat ke nomor sendiri di WhatsApp, lalu ketik:
 *        .menu              -> bantuan
 *        .grup              -> daftar semua grup (bernomor)
 *        .cari <kata>       -> cari grup berdasarkan nama
 *        .backup 3          -> backup grup nomor 3
 *        .backup 1,4,7      -> backup beberapa grup sekaligus
 *        .backup semua      -> backup semua grup
 *
 * Hasil dikirim sebagai file: nomor-member-(namagrup).txt
 * Isi file: satu nomor per baris, format 08xxx. Admin & superadmin (pembuat grup) TIDAK ikut.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  Browsers,
} from 'baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = path.join(__dirname, 'auth')
const HASIL_DIR = path.join(__dirname, 'hasil')
const PREFIX = '.'
const pairingNumber = (process.argv[2] || '').replace(/\D/g, '')

fs.mkdirSync(HASIL_DIR, { recursive: true })

const logger = pino({ level: 'silent' })
const startTime = Math.floor(Date.now() / 1000)
let daftarGrup = [] // cache hasil perintah .grup / .cari  -> [{ id, subject }]
const sentByBot = new Set() // id pesan yang dikirim bot (hindari loop)

// ---------------------------------------------------------------- helpers
const bareNumber = (jid = '') => jid.split('@')[0].split(':')[0]

function formatNomor(digits) {
  digits = String(digits).replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('62')) return '0' + digits.slice(2) // Indonesia -> 08xxx
  return '+' + digits // nomor luar negeri tetap dengan kode negara
}

function namaFileAman(nama) {
  return (nama || 'tanpa-nama')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'tanpa-nama'
}

async function semuaGrup(sock) {
  const all = await sock.groupFetchAllParticipating()
  return Object.values(all)
    .map((g) => ({ id: g.id, subject: g.subject || '(tanpa nama)' }))
    .sort((a, b) => a.subject.localeCompare(b.subject, 'id', { sensitivity: 'base' }))
}

/** Ubah 1 participant -> nomor telepon (digit) atau null jika tidak bisa */
async function resolveNomor(sock, p) {
  const kandidat = [p.phoneNumber, p.jid, p.id].filter(Boolean)
  for (const j of kandidat) {
    if (j.endsWith('@s.whatsapp.net')) return bareNumber(j)
  }
  // Grup mode LID (privasi nomor): coba mapping LID -> nomor
  const lid = [p.lid, p.id].find((j) => j && j.endsWith('@lid'))
  if (lid) {
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lid)
      if (pn) return bareNumber(pn)
    } catch {}
  }
  return null
}

async function backupGrup(sock, groupId, kirimKe) {
  const meta = await sock.groupMetadata(groupId)
  const me = [sock.user?.id, sock.user?.lid].filter(Boolean).map(bareNumber)

  const nomor = new Set()
  let jmlAdmin = 0
  let gagal = 0

  for (const p of meta.participants) {
    if (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin) {
      jmlAdmin++
      continue
    }
    const digits = await resolveNomor(sock, p)
    if (!digits) { gagal++; continue }
    if (me.includes(digits)) continue // lewati nomor sendiri
    const n = formatNomor(digits)
    if (n) nomor.add(n)
  }

  const list = [...nomor].sort()
  const namaGrup = namaFileAman(meta.subject)
  const fileName = `nomor-member-(${namaGrup}).txt`
  const filePath = path.join(HASIL_DIR, fileName)
  fs.writeFileSync(filePath, list.join('\n'), 'utf8')

  let caption =
    `✅ *${meta.subject}*\n` +
    `👥 Total peserta: ${meta.participants.length}\n` +
    `👮 Admin (tidak disimpan): ${jmlAdmin}\n` +
    `📇 Nomor member tersimpan: ${list.length}`
  if (gagal) caption += `\n⚠️ ${gagal} nomor disembunyikan WhatsApp (privasi LID), tidak bisa diambil`

  if (list.length === 0) {
    await kirim(sock, kirimKe, { text: caption + '\n\n(File kosong, tidak dikirim)' })
  } else {
    await kirim(sock, kirimKe, {
      document: fs.readFileSync(filePath),
      fileName,
      mimetype: 'text/plain',
      caption,
    })
  }
  console.log(`[backup] ${meta.subject}: ${list.length} nomor -> hasil/${fileName}`)
}

async function kirim(sock, jid, content) {
  const m = await sock.sendMessage(jid, content)
  if (m?.key?.id) sentByBot.add(m.key.id)
  return m
}

function teksDaftar(list, judul) {
  if (!list.length) return 'Tidak ada grup ditemukan.'
  const baris = list.map((g, i) => `${i + 1}. ${g.subject}`)
  return `📋 *${judul}* (${list.length})\n\n${baris.join('\n')}\n\nKetik *.backup <nomor>* contoh: .backup 1  |  .backup 1,3,5  |  .backup semua`
}

const MENU =
  `🤖 *Bot Backup Nomor Member Grup*\n\n` +
  `*.grup* – lihat daftar grup\n` +
  `*.cari <kata>* – cari grup by nama\n` +
  `*.backup <no>* – backup 1 grup (contoh .backup 2)\n` +
  `*.backup 1,4,7* – backup beberapa grup\n` +
  `*.backup semua* – backup semua grup\n\n` +
  `Hasil: file nomor-member-(namagrup).txt, admin tidak ikut.`

// ---------------------------------------------------------------- command handler
async function handleCommand(sock, text, replyJid) {
  const [cmdRaw, ...rest] = text.slice(PREFIX.length).trim().split(/\s+/)
  const cmd = (cmdRaw || '').toLowerCase()
  const arg = rest.join(' ').trim()

  switch (cmd) {
    case 'menu':
    case 'help':
    case 'bantuan':
      return kirim(sock, replyJid, { text: MENU })

    case 'grup':
    case 'group':
    case 'list': {
      daftarGrup = await semuaGrup(sock)
      return kirim(sock, replyJid, { text: teksDaftar(daftarGrup, 'Daftar Grup') })
    }

    case 'cari': {
      if (!arg) return kirim(sock, replyJid, { text: 'Contoh: .cari alumni' })
      const all = await semuaGrup(sock)
      daftarGrup = all.filter((g) => g.subject.toLowerCase().includes(arg.toLowerCase()))
      return kirim(sock, replyJid, { text: teksDaftar(daftarGrup, `Hasil cari "${arg}"`) })
    }

    case 'backup': {
      if (!arg) return kirim(sock, replyJid, { text: 'Contoh: .backup 1  |  .backup 1,3,5  |  .backup semua\nKetik .grup dulu untuk lihat nomor grup.' })

      let target = []
      if (/^(semua|all)$/i.test(arg)) {
        target = await semuaGrup(sock)
      } else {
        if (!daftarGrup.length) daftarGrup = await semuaGrup(sock)
        const idx = [...new Set(arg.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => !isNaN(n)))]
        const salah = idx.filter((n) => n < 1 || n > daftarGrup.length)
        if (!idx.length || salah.length) {
          return kirim(sock, replyJid, { text: `Nomor grup tidak valid${salah.length ? ': ' + salah.join(', ') : ''}. Ketik .grup untuk lihat daftar.` })
        }
        target = idx.map((n) => daftarGrup[n - 1])
      }

      await kirim(sock, replyJid, { text: `⏳ Memproses ${target.length} grup...` })
      for (const g of target) {
        try {
          await backupGrup(sock, g.id, replyJid)
        } catch (e) {
          console.error('[backup error]', g.subject, e)
          await kirim(sock, replyJid, { text: `❌ Gagal backup "${g.subject}": ${e.message}` })
        }
        await new Promise((r) => setTimeout(r, 1500)) // jeda biar aman dari spam-limit
      }
      return kirim(sock, replyJid, { text: '✔️ Selesai. File juga tersimpan di folder hasil/ di komputer.' })
    }
  }
}

// ---------------------------------------------------------------- koneksi
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.windows('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  })

  sock.ev.on('creds.update', saveCreds)

  if (pairingNumber && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairingNumber)
        console.log(`\n🔑 Kode pairing: ${code}\nWhatsApp > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon\n`)
      } catch (e) {
        console.error('Gagal minta kode pairing:', e.message)
      }
    }, 3000)
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr && !pairingNumber) {
      console.log('\nScan QR ini di WhatsApp > Perangkat tertaut > Tautkan perangkat:\n')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'open') {
      console.log(`\n✅ Terhubung sebagai ${bareNumber(sock.user.id)}`)
      console.log('Buka chat ke nomor sendiri di WhatsApp lalu ketik .menu\n')
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Logout. Hapus folder "auth" lalu jalankan ulang untuk login lagi.')
        process.exit(1)
      }
      console.log('Koneksi terputus, menyambung ulang...', code ?? '')
      setTimeout(start, 3000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        if (!msg.message || !msg.key.fromMe) continue // hanya perintah dari akun sendiri
        if (sentByBot.has(msg.key.id)) continue
        const ts = Number(msg.messageTimestamp || 0)
        if (ts && ts < startTime - 5) continue // abaikan pesan lama

        // Keamanan: perintah hanya diproses di chat ke diri sendiri,
        // supaya daftar nomor tidak terkirim ke grup/orang lain.
        const remote = msg.key.remoteJid || ''
        const remoteAlt = msg.key.remoteJidAlt || ''
        const selfIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map((j) => bareNumber(jidNormalizedUser(j)))
        const isSelfChat = [remote, remoteAlt].some((j) => j && !j.endsWith('@g.us') && selfIds.includes(bareNumber(j)))
        if (!isSelfChat) continue

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          ''
        if (!text.startsWith(PREFIX)) continue

        console.log('[perintah]', text)
        await handleCommand(sock, text.trim(), remote)
      } catch (e) {
        console.error('[error]', e)
      }
    }
  })
}

start()
