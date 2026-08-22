# Güvenlik Notları — EduNova

Bu belge platformdaki güvenlik kontrollerini, işletme kurallarını ve
üretime çıkmadan önce yapılması gerekenleri özetler.

---

## 1. Kritik: statik dosya sunumu

**Önceki durum.** `server/index.js` içinde `express.static(ROOT)` ile **tüm proje
kökü** yayınlanıyordu. Bu yüzden aşağıdakiler kimlik doğrulaması olmadan,
sadece tarayıcıya adres yazarak indirilebiliyordu:

| Yol | İçerik |
|-----|--------|
| `/Database/edunova.sql` | Tüm kullanıcı e-postaları, bcrypt şifre hash'leri, **tüm CTF flag'leri** |
| `/server/.env` | Veritabanı kullanıcı adı + şifresi, `JWT_SECRET` |
| `/server/routes/*.js` | Tüm sunucu kaynak kodu |
| `/server/uploads/**` | Yüklenen tüm ders/CTF dosyaları |

`JWT_SECRET` sızdığında saldırgan istediği kullanıcı için (admin dahil) geçerli
token üretebilir — yani tam yetki devralma.

**Şimdiki durum.** Sunucu yalnızca açıkça izin verilen dosyaları servis eder
(`server/middleware/security.js` → `PUBLIC_ROOT_FILES`):

- kök: `index.html`, `styles.css`, `script.js`, tanıtım sayfaları, `verify-certificate.html`
- `/admin/**`: yalnızca `.html .css .js .map .svg .png .jpg .jpeg .webp .ico .woff .woff2`

Bunun dışındaki her istek 404 döner. Yüklenen dosyalara yalnızca kimlik
doğrulamalı API uçları (`/api/modules/:id/attachments/:aid/download`,
`/api/ctf/:id/file`) üzerinden erişilir.

> **Yeni bir kök sayfa eklerseniz** `PUBLIC_ROOT_FILES` listesine de eklemeniz gerekir.

---

## 2. Sırlar

- `server/config.js` açılışta doğrulama yapar; `JWT_SECRET` yoksa, 32 karakterden
  kısaysa veya `.env.example` yer tutucusuysa **sunucu başlamaz**.
- `JWT_SECRET` bu çalışmada döndürüldü — önceki tüm token'lar geçersizdir.
- Yeni sır üretmek için:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

- `.gitignore`, `.env` dosyalarına ek olarak artık `Database/`, `*.sql` dökümleri
  ve `server/uploads/` dizinini de dışlar.

### ⚠ Üretim öncesi yapılması gerekenler

1. **Veritabanı şifresini değiştirin.** `hasan/hasan123` hem `.env` hem
   `docker-compose.yml` içinde geçen zayıf bir geliştirme şifresidir.
   `docker-compose.yml` artık `POSTGRES_PASSWORD` ortam değişkenini okur.
2. **`Database/*.sql` dökümlerini kaldırın veya taşıyın.** Web'den artık
   erişilemez ama diskte duruyorlar ve hash + flag içeriyorlar. Depoya
   girdilerse geçmişi temizleyin ve tüm flag'leri döndürün.
3. `CORS_ORIGINS` değişkenini gerçek alan adlarınızla doldurun (üretimde zorunlu).
4. Reverse proxy arkasındaysanız `TRUST_PROXY=1` verin — yoksa hız sınırlayıcılar
   tüm istekleri tek IP sanar.
5. `NODE_ENV=production` ayarlayın (HSTS açılır, DB bağlantısında TLS doğrulanır).

---

## 3. Kimlik doğrulama ve oturum

| Kontrol | Davranış |
|---------|----------|
| Token ömrü | `JWT_EXPIRES_IN`, varsayılan **12 saat** (önceden 7 gün) |
| Rol kaynağı | **Veritabanı**, token içindeki `role` iddiası değil |
| Oturum iptali | `users.token_version` — şifre değişimi/sıfırlaması tüm eski token'ları geçersiz kılar |
| Silinen kullanıcı | Token hâlâ imzalı olsa da erişim reddedilir |
| Önbellek | Kullanıcı durumu 10 sn önbelleklenir; iptal olaylarında `invalidateUser()` ile anında düşer |

### Şifre politikası

En az **10 karakter**, en az bir harf ve bir rakam. Aynı kural hem sunucuda
(`server/lib/validate.js`) hem arayüzde uygulanır.

### Brute-force koruması

| Uç | Sınır |
|----|-------|
| `POST /api/auth/login` (IP başına) | 40 / 15 dk |
| `POST /api/auth/login` (hesap başına) | 8 / 15 dk |
| `POST /api/ctf/:id/submit` (kullanıcı başına) | 20 / dk |
| `GET /api/certificates/verify/:code` | 30 / 15 dk |
| Tüm `/api/*` | 300 / dk |

İki katmanlı giriş sınırı bilinçli bir tercihtir: tek NAT arkasındaki bir sınıfın
birbirini kilitlememesi için IP sınırı geniş, hedefli saldırıyı durdurmak için
hesap sınırı dardır.

Kullanıcı numaralandırmaya karşı, e-posta bulunamadığında da sahte bir hash'e
karşı `bcrypt.compare` çalıştırılır; yanıt süresi ve mesajı aynı kalır.

### Medya token'ları

`<video src>` gibi elementler `Authorization` başlığı gönderemez. 12 saatlik
oturum token'ını URL'e koymak yerine:

```
POST /api/auth/media-token   →   { token, expires_in: 300 }
```

Bu token yalnızca **5 dakika** geçerlidir ve **yalnızca**
`/api/modules/:id/attachments/:aid/download` yolunda `?token=` ile kabul edilir.
Oturum token'ı URL'de, medya token'ı da `Authorization` başlığında **reddedilir**.

---

## 4. Yetkilendirme ve veri minimizasyonu

- Tüm API router'ları `authenticate` ile korunur; tek istisna herkese açık
  sertifika doğrulama ucudur (hız sınırlı).
- Öğrenciler için liderlik tablosunda **diğer öğrencilerin e-postaları gizlenir**
  (kendi kaydı ve admin görünümü hariç).
- Sınav soruları öğrenciye `correct_index` alanı olmadan gönderilir; puanlama
  yalnızca sunucuda yapılır.
- CTF flag'leri hiçbir listeleme ucunda dönmez; karşılaştırma sabit zamanlıdır.
- Modül `notes` alanları ve kilitli modüller öğrenci yanıtlarından ayıklanır.

---

## 5. HTTP güvenlik başlıkları

`server/middleware/security.js` tüm yanıtlara ekler:

`Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`,
`X-Permitted-Cross-Domain-Policies`, üretimde `Strict-Transport-Security`.
`X-Powered-By` kapatıldı. `/api/*` yanıtları `no-store` ile işaretlenir.

CSP `'unsafe-inline'` içerir çünkü paneller inline `<script>` ve `onclick`
kullanır. Yine de `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`
en tehlikeli saldırı yüzeylerini kapatır. Inline kod HTML'den ayrıştırılırsa
CSP nonce'a geçilebilir.

### CORS

Üretimde yalnızca `CORS_ORIGINS` listesindeki tam origin'ler kabul edilir.
`origin: "null"` (yani `file://` veya sandbox'lı iframe) **artık kabul
edilmiyor** — `credentials: true` ile birlikte bu, yerel bir HTML dosyasının
oturum açmış kullanıcının verisini okumasına izin veriyordu.

---

## 6. XSS

Tüm panel sayfaları sunucudan gelen veriyi `innerHTML` ile birleştirir. Ortak
kaçış fonksiyonları `admin-shared.js` ve `student-shared.js` içinde tanımlıdır:

| Fonksiyon | Kullanım |
|-----------|----------|
| `escapeHtml(s)` | metin içeriği |
| `escapeAttr(s)` | öznitelik değeri (backtick dahil) |
| `safeUrl(u)` | `href`/`src` — `javascript:`, `data:` şemalarını reddeder |
| `escapeJsString(s)` | inline `onclick="fn('...')"` içine gömülen metin |

Daha önce sayfa başına tanımlanan `d.textContent → d.innerHTML` yöntemi tırnak
karakterlerini kaçırmıyordu; hepsi yukarıdaki güçlü sürüme yönlendirildi.

Ayrıca başlıkların `onclick` özniteliğine gömülmesi (`askDelete(id,'başlık')`)
tamamen kaldırıldı — artık yalnızca sayısal id gömülür, başlık istemci
tarafındaki listeden okunur.

> **Yeni bir `innerHTML` şablonu yazarken** sunucudan gelen her alanı
> `escapeHtml`/`escapeAttr` içinden geçirin.

---

## 7. Dosya yükleme ve indirme

- Rastgele dosya adı (`crypto.randomBytes(16)`), uzantı izin listesi, boyut sınırı
  (CTF 50 MB, doküman 80 MB, video 500 MB).
- İndirmede `path.resolve` ile yükleme dizini dışına çıkış engellenir.
- **Yalnızca gerçek video dosyaları** tarayıcıda inline açılır. Diğer her şey
  `application/octet-stream` + `nosniff` ile indirilir; böylece yüklenen bir
  `.svg`/`.html` aynı origin'de çalıştırılamaz.

---

## 8. Girdi doğrulama

- Sayısal route parametreleri (`:id`, `:aid`, `:moduleId`) router seviyesinde
  doğrulanır (`guardNumericParams`); geçersiz değer 400 döner, veritabanı
  hatasıyla 500 üretmez.
- E-posta formatı, metin uzunlukları ve şifre politikası `server/lib/validate.js`.
- JSON gövde boyutu 1 MB ile sınırlı.
- Tüm SQL sorguları parametrelidir; `ORDER BY` gibi dinamik parçalar sabit
  izin listelerinden seçilir.
- Hata yakalayıcı istemciye asla yığın izi göndermez.

---

## 9. Seed verisi

`npm run db:init` artık sabit varsayılan şifre kullanmaz. `SEED_ADMIN_PASSWORD` /
`SEED_STUDENT_PASSWORD` verilmezse kriptografik rastgele şifre üretilir ve
**yalnızca bir kez** ekrana yazılır.

---

## 10. Bilinen kalan riskler

| Konu | Durum / öneri |
|------|---------------|
| Token `localStorage`'da | Bir XSS açığı token'ı çalabilir. Kalıcı çözüm: `httpOnly` + `SameSite=Strict` çerez + CSRF token. Mevcut mimaride kapsamlı bir değişiklik gerektirir. |
| CSP `'unsafe-inline'` | Inline script/handler'lar HTML'den ayrıştırılırsa nonce tabanlı CSP'ye geçilebilir. |
| jsDelivr bağımlılıkları | `qrcode.js` ve sınav gözetimi için `tfjs`/`blazeface` hâlâ CDN'den gelir. İnternet erişimi olan bir ortamda SRI hash'i sabitleyin (ilgili HTML dosyalarında TODO notu var) veya yerel kopyaya geçin. Chart.js yerel kopyaya alındı. |
| `GET /api/students/export/csv?withPasswords=1` | **Tüm** öğrencilerin şifresini sıfırlar. Admin yetkisi ister ve oturumları kapatır, ama geri alınamaz bir toplu işlemdir; arayüzdeki onay adımını kaldırmayın. |
| Sınav gözetimi | Kamera/tam ekran kontrolleri istemci tarafındadır; kararlı bir kullanıcı atlatabilir. Sunucu yalnızca ihlal olaylarını kaydeder. |
| Hız sınırı deposu | Bellek içidir. Birden fazla sunucu örneği çalıştırırsanız Redis destekli bir store kullanın. |
