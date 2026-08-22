# EduNova — Siber Güvenlik Eğitim Portalı

EduNova, siber güvenlik eğitimi için geliştirilmiş tam kapsamlı bir **eğitim yönetim platformudur**. Kurumsal tanıtım sayfaları, öğrenci paneli ve yönetici paneli tek bir projede birleşir; veriler PostgreSQL üzerinde saklanır ve Node.js/Express API ile sunulur.

## Proje Hakkında

Platform iki ana bölümden oluşur:

| Bölüm | Açıklama |
|-------|----------|
| **Kurumsal site** | Anasayfa, hizmetler, misyon/vizyon, eğitmen profili; TR/EN dil desteği ve koyu/açık tema |
| **Yönetim & öğrenci paneli** | Giriş sonrası role göre ayrılan admin ve öğrenci arayüzleri |

### Öğrenci özellikleri

- Modül bazlı müfredat ve ders ilerlemesi
- Laboratuvar ve sınav ekranları
- CTF (Capture The Flag) yarışmaları ve flag gönderimi
- Liderlik tablosu ve aktivite raporu
- Duyurular ve sertifika görüntüleme
- Profil ve şifre yönetimi

### Yönetici özellikleri

- Öğrenci ekleme, düzenleme, şifre sıfırlama ve CSV/Excel dışa aktarma
- Modül, ders, ek dosya ve sınav yönetimi
- CTF görevi oluşturma ve yayınlama
- Duyuru yönetimi
- Sertifika oluşturma ve doğrulama kodu üretimi
- Sınav sonuçları ve genel aktivite takibi

### Müfredat modülleri (örnek seed verisi)

1. Network Temelleri
2. Web Güvenliği
3. Ağ İçi Saldırılar *(kilitli)*
4. OS & Toollar *(kilitli)*
5. CTF & Zafiyetler *(kilitli)*
6. Cloud Güvenliği *(kilitli)*

---

## Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| Frontend | HTML, CSS, Vanilla JavaScript |
| Backend | Node.js, Express 4 |
| Veritabanı | PostgreSQL 16 |
| Kimlik doğrulama | JWT + bcrypt |
| Geliştirme | Docker Compose, nodemon |

---

## Proje Yapısı

```
egitim_portali/
├── docker-compose.yml          # PostgreSQL + Adminer
├── README.md
└── agdsecscop_team/
    ├── index.html              # Kurumsal anasayfa
    ├── styles.css, script.js   # Ortak stil ve i18n
    ├── admin/                  # Giriş, admin ve öğrenci panelleri
    ├── Database/               # Eski SQL yedekleri (opsiyonel)
    └── server/
        ├── index.js            # API + statik dosya sunucusu
        ├── db/
        │   ├── schema.sql      # Tablo şeması
        │   ├── init.js         # Tablo oluşturma + seed verisi
        │   └── client.js       # PostgreSQL bağlantısı
        ├── routes/             # REST API uç noktaları
        ├── middleware/         # JWT doğrulama
        ├── .env.example
        └── package.json
```

Backend, `agdsecscop_team/` klasörünü statik olarak sunar. Bu sayede tek bir sunucu üzerinden hem API hem arayüz çalışır; ayrı bir frontend build adımı gerekmez.

---

## Gereksinimler

- [Node.js](https://nodejs.org/) 18 veya üzeri
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (önerilen) **veya** yerel PostgreSQL kurulumu
- npm (Node.js ile birlikte gelir)

---

## Kurulum (Windows — Docker ile)

Tüm komutlar proje kökünde (`egitim_portali/`) başlar.

### 1. Veritabanını başlat

```powershell
docker compose up -d
```

| Servis | Adres | Bilgiler |
|--------|-------|----------|
| PostgreSQL | `localhost:5432` | DB: `edunova`, Kullanıcı: `hasan`, Şifre: `hasan123` |
| Adminer (DB arayüzü) | http://localhost:8081 | System: PostgreSQL, Server: `postgres`, aynı kullanıcı/şifre |

> Adminer container içinden veritabanına bağlandığı için **Server** alanına `localhost` değil `postgres` yazın.

### 2. Backend bağımlılıklarını kur

```powershell
cd .\agdsecscop_team\server
npm install
```

### 3. Ortam değişkenlerini ayarla

```powershell
copy .env.example .env
```

`.env` dosyasını düzenleyin:

```env
PORT=3001
DATABASE_URL=postgresql://hasan:hasan123@localhost:5432/edunova
JWT_SECRET=uzun_ve_rastgele_bir_gizli_anahtar
JWT_EXPIRES_IN=7d
```

### 4. Tabloları ve örnek veriyi oluştur

```powershell
npm run db:init
```

Bu komut tabloları oluşturur, demo kullanıcıları, modülleri, CTF görevlerini ve duyuruları yükler.

### 5. Sunucuyu çalıştır

```powershell
npm run dev
```

Başarılı çıktı:

```
EduNova API → http://localhost:3001
```

### 6. Uygulamayı aç

| Sayfa | URL |
|-------|-----|
| Kurumsal site | http://localhost:3001/ |
| Giriş | http://localhost:3001/admin/login.html |
| API sağlık kontrolü | http://localhost:3001/api/health |

---

## Demo Hesapları

`npm run db:init` sonrası kullanılabilir:

| Rol | E-posta | Şifre |
|-----|---------|-------|
| Yönetici | `admin@edunova.com` | `admin2026` |
| Öğrenci | `selin@edunova.com` | `ogrenci123` |

Diğer öğrenci hesapları (`ali@`, `zeynep@`, `mert@`, `emre@`) aynı şifreyi kullanır.

Seed şifrelerini değiştirmek için `db:init` öncesinde ortam değişkeni verebilirsiniz:

```powershell
$env:SEED_ADMIN_PASSWORD="yeni_admin_sifresi"
$env:SEED_STUDENT_PASSWORD="yeni_ogrenci_sifresi"
npm run db:init
```

---

## Docker Kullanmadan Kurulum

Yerel PostgreSQL kuruluysa:

```powershell
psql -h localhost -U postgres -c "CREATE USER hasan WITH PASSWORD 'hasan123';"
psql -h localhost -U postgres -c "CREATE DATABASE edunova OWNER hasan;"
```

Ardından `.env` içindeki `DATABASE_URL` değerini kendi bağlantı bilgilerinize göre ayarlayıp `npm run db:init` ve `npm run dev` adımlarını uygulayın.

---

## API Uç Noktaları (özet)

| Prefix | İşlev |
|--------|-------|
| `/api/auth` | Giriş, şifre değiştirme |
| `/api/students` | Öğrenci CRUD, dışa aktarma |
| `/api/modules` | Modül ve ders yönetimi |
| `/api/progress` | İlerleme kaydı |
| `/api/exams` | Modül sınavları |
| `/api/ctf` | CTF görevleri ve çözümler |
| `/api/leaderboard` | Liderlik tablosu |
| `/api/certificates` | Sertifika oluşturma ve doğrulama |
| `/api/announcements` | Duyurular |
| `/api/admin/activity` | Yönetici aktivite özeti |

---

## npm Komutları

`agdsecscop_team/server/` dizininde:

| Komut | Açıklama |
|-------|----------|
| `npm run dev` | Geliştirme sunucusu (nodemon, otomatik yeniden başlatma) |
| `npm start` | Üretim modu |
| `npm run db:init` | Şema + seed verisi (mevcut tabloları sıfırlar) |

---

## Sık Karşılaşılan Sorunlar

**Port 3001 dolu**

```powershell
netstat -ano | findstr :3001
taskkill /PID <pid> /F
```

**PostgreSQL bağlantı hatası**

- Docker çalışıyor mu: `docker compose ps`
- `.env` içindeki `DATABASE_URL` ile `docker-compose.yml` bilgileri uyumlu mu kontrol edin
- Container henüz hazır değilse birkaç saniye bekleyip `npm run db:init` tekrar deneyin

**Adminer açılmıyor**

- Adres: http://localhost:8081 (8080 değil; port çakışmasını önlemek için 8081 kullanılır)

**Giriş yapılamıyor**

- `npm run db:init` çalıştırıldığından emin olun
- Sunucunun `http://localhost:3001` üzerinden açıldığını doğrulayın (dosyayı doğrudan `file://` ile açmayın)

**Veritabanını sıfırlamak**

```powershell
docker compose down -v
docker compose up -d
cd .\agdsecscop_team\server
npm run db:init
```

---

## Üretim Notları

- `JWT_SECRET` değerini güçlü ve benzersiz bir anahtarla değiştirin
- `NODE_ENV=production` ortamında PostgreSSL ayarlarını gözden geçirin
- Demo şifrelerini üretim ortamında kullanmayın
- `.env` dosyasını asla versiyon kontrolüne eklemeyin (`.gitignore` içinde tanımlıdır)

---

## Lisans ve Katkı

Bu proje AGDSECSCOP ekibi tarafından geliştirilmiştir. Sorular ve katkılar için depo sahibiyle iletişime geçin.


<img width="1896" height="876" alt="image" src="https://github.com/user-attachments/assets/05d7acfd-fc72-4d8f-a317-7a05ae63ee74" />
Karşılama sayfası

<img width="1920" height="902" alt="image" src="https://github.com/user-attachments/assets/e8df9e54-9afe-4536-9f38-0c671f79561f" />

login page


Admin Page<img width="1918" height="899" alt="image" src="https://github.com/user-attachments/assets/2824f75f-3165-4f49-8d5d-9787b32c6c10" />

Admin Panel


<img width="1920" height="899" alt="image" src="https://github.com/user-attachments/assets/c84e7383-8a10-4385-b382-32826e9795b1" />

Modüller Sayfası


<img width="1915" height="905" alt="image" src="https://github.com/user-attachments/assets/12564fd2-165d-411c-93fa-fcf40338c858" />

Öğrenci Paneli





