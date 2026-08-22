## Hızlı Kurulum (Windows + Docker)

### 1) PostgreSQL + Adminer'i başlat

Proje kökünde (`egitim_portali/`) çalıştır:

```powershell
docker compose up -d
```

Adminer'a (veritabanı yönetim arayüzü) ihtiyacınız varsa yalnızca geliştirmede:

```powershell
docker compose --profile dev up -d
```

> Postgres ve Adminer artık yalnızca `127.0.0.1` üzerinde dinler; ağdan
> doğrudan erişilemezler.

- PostgreSQL: `localhost:5432` (DB: `edunova`)
- Adminer: `http://localhost:8081` (8080 başka uygulamada kullanılıyorsa çakışmayı önlemek için 8081)

Adminer giriş bilgileri:
- System: `PostgreSQL`
- Server: `postgres`
- Username: `hasan`
- Password: `hasan123`
- Database: `edunova`

> Not: Host bilgisini `localhost` yerine `postgres` vermek gerekir; çünkü Adminer container içinden DB container'a bağlanır.

### 2) Backend bağımlılıklarını kur

```powershell
cd .\agdsecscop_team\server
npm install
```

### 3) `.env` dosyasını hazırla

`.env.example` dosyasını `.env` olarak kopyalayın ve **mutlaka** bir `JWT_SECRET`
üretin — sır eksik, kısa (< 32 karakter) veya örnekteki yer tutucu ise sunucu
başlamaz:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 4) Tabloları ve seed veriyi oluştur

```powershell
npm run db:init
```

> Seed hesaplarının şifresi artık sabit değildir. `SEED_ADMIN_PASSWORD` /
> `SEED_STUDENT_PASSWORD` vermezseniz rastgele üretilir ve **yalnızca bir kez**
> ekrana yazılır — çıktıyı kaydedin. Sabitlemek için:
>
> ```powershell
> $env:SEED_ADMIN_PASSWORD="..." ; $env:SEED_STUDENT_PASSWORD="..." ; npm run db:init
> ```

### 5) Backend'i çalıştır

```powershell
npm run dev
```

API healthcheck: `http://localhost:3001/api/health`

## Manuel kurulum (Docker kullanmadan)

Yerel PostgreSQL kuruluysa DB oluştur:

```bash
psql -h localhost -U hasan -d postgres -c "CREATE DATABASE edunova;"
```

Bağlantı örneği:

`postgresql://hasan:hasan123@localhost:5432/edunova`

---

## Güvenlik

Platformdaki güvenlik kontrolleri, üretim öncesi yapılacaklar ve bilinen kalan
riskler için **[SECURITY.md](./SECURITY.md)** dosyasına bakın.

Kısa özet:

- Sunucu yalnızca açıkça izin verilen statik dosyaları yayınlar; `Database/`,
  `server/` ve `uploads/` dizinlerine web üzerinden erişilemez.
- `JWT_SECRET` doğrulanmadan sunucu açılmaz; token ömrü 12 saat.
- Şifre değişimi/sıfırlaması açık oturumların tümünü geçersiz kılar.
- Giriş, flag gönderimi ve sertifika doğrulama uçları hız sınırlıdır.
- Şifre politikası: en az 10 karakter, harf + rakam.
