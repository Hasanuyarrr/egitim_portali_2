# AWS'de Yayına Alma — Adım Adım

Bu rehber SeCScop portalını AWS'de sıfırdan ayağa kaldırır.

## Mimari kararı

**EC2 + RDS PostgreSQL + nginx (TLS)** öneriliyor. Sebep: uygulama yüklenen ders
videolarını ve CTF eklerini **diske** yazıyor. Fargate / App Runner / Elastic
Beanstalk gibi dosya sistemi geçici olan servislerde bu dosyalar her deploy'da
kaybolur. EC2'de EBS diski kalıcıdır.

```
İnternet
   │  443
   ▼
┌─────────────────── EC2 (Ubuntu 24.04, t3.small) ───────────────────┐
│  nginx  ──proxy──▶  Node/Express :3001  ──▶  /var/lib/secscop/uploads │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ 5432 (yalnızca EC2 güvenlik grubundan)
                               ▼
                   RDS PostgreSQL (public erişim KAPALI)
```

**Yaklaşık aylık maliyet** (us-east-1, on-demand): EC2 t3.small ~15 $, EBS 30 GB
~2,5 $, RDS db.t4g.micro ~13 $, RDS depolama 20 GB ~2,5 $ → **~35 $**.
Yeni hesaplarda 12 ay ücretsiz katman t3.micro + db.t3.micro'yu kapsar; t3.micro
(1 GB RAM) `npm install` sırasında zorlanır, aşağıda swap adımı var.

> Yönetilen TLS ve birden fazla sunucu istiyorsanız nginx+certbot yerine
> **ALB + ACM** kullanın (~+18 $/ay). Adımlar aynı, yalnızca 7. bölüm değişir.

---

## 0. Ön koşullar

- AWS hesabı ve faturalandırma uyarısı (Billing → Budgets)
- Bir alan adı (TLS için gerekli) ve DNS yönetimi
- Yerelde çalışan bir kopya (kurulumu doğrulamak için)

**Bölge seçin ve sabit kalın.** Örneklerde `eu-central-1` (Frankfurt) varsayılıyor;
Türkiye'den gecikme düşüktür ve KVKK açısından AB bölgesi tercih edilir.

---

## 1. Güvenlik grupları

Önce güvenlik gruplarını oluşturun; RDS ve EC2 sihirbazları bunları soracak.

**EC2 → Security Groups → Create security group**

| Ad | Kural | Kaynak | Not |
|----|-------|--------|-----|
| `secscop-web-sg` | HTTP 80 | `0.0.0.0/0` | certbot doğrulaması + HTTPS yönlendirmesi |
| | HTTPS 443 | `0.0.0.0/0` | |
| | — | — | **SSH 22 AÇMAYIN** (aşağıya bakın) |

| Ad | Kural | Kaynak |
|----|-------|--------|
| `secscop-db-sg` | PostgreSQL 5432 | **Source: `secscop-web-sg`** (IP değil, güvenlik grubu) |

> **SSH yerine SSM Session Manager.** Port 22'yi internete açmak bu projedeki en
> büyük gereksiz risktir. Session Manager tarayıcıdan/CLI'dan shell verir, açık
> port gerektirmez. 3. adımda IAM rolünü ekliyoruz.

---

## 2. RDS PostgreSQL

**RDS → Create database**

| Ayar | Değer |
|------|-------|
| Engine | PostgreSQL 16 |
| Template | Dev/Test (veya Free tier) |
| DB instance identifier | `secscop-db` |
| Master username | `secscop` |
| Master password | **Güçlü, rastgele.** Not: `hasan123` gibi bir şey KULLANMAYIN |
| Instance class | `db.t4g.micro` |
| Storage | 20 GB gp3, **Storage autoscaling açık** |
| **Public access** | **No** ← kritik |
| VPC security group | `secscop-db-sg` |
| Initial database name | `edunova` |
| Backup retention | 7 gün |
| Encryption | Açık (varsayılan) |
| Deletion protection | Açık |

Oluşturma 5–10 dakika sürer. Bitince **Endpoint**'i not edin:
`secscop-db.xxxxx.eu-central-1.rds.amazonaws.com`

> Master parolayı **Secrets Manager**'a koymak isterseniz "Manage master
> credentials in AWS Secrets Manager" seçeneğini işaretleyin. Basit kurulumda
> parolayı doğrudan `.env`'e yazmak da kabul edilebilir (dosya izni 600).

---

## 3. EC2 sunucusu

**EC2 → Launch instance**

| Ayar | Değer |
|------|-------|
| Name | `secscop-app` |
| AMI | **Ubuntu Server 24.04 LTS** |
| Instance type | `t3.small` (free tier için `t3.micro`) |
| Key pair | "Proceed without a key pair" (SSM kullanacağız) |
| Security group | `secscop-web-sg` |
| Storage | 30 GB gp3 |
| **Advanced → IAM instance profile** | Aşağıdaki rolü oluşturup seçin |

**IAM rolü:** IAM → Roles → Create role → AWS service → EC2 →
`AmazonSSMManagedInstanceCore` politikasını ekleyin → ad: `secscop-ec2-role`.

Instance açıldıktan sonra **Elastic IP** ayırın ve bağlayın (yeniden başlatmada
IP değişmesin):
EC2 → Elastic IPs → Allocate → Associate → instance'ı seçin.

**DNS:** Alan adınızın `A` kaydını bu Elastic IP'ye yönlendirin. Yayılmayı bekleyin:

```bash
nslookup portal.alanadiniz.com
```

**Bağlanın:** EC2 → instance seçin → **Connect** → **Session Manager** → Connect.

---

## 4. Sunucu kurulumu

Session Manager oturumunda:

```bash
sudo -i
apt-get update && apt-get upgrade -y
```

Free tier (1 GB RAM) kullanıyorsanız swap ekleyin, yoksa `npm install` OOM ile ölür:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs git nginx
```

Sürümü doğrulayın (20 veya üstü olmalı):

```bash
node -v && npm -v
```

Uygulama kullanıcısı ve dizinler:

```bash
adduser --system --group --home /opt/secscop secscop && mkdir -p /var/lib/secscop/uploads && chown -R secscop:secscop /var/lib/secscop
```

Kodu çekin (repo private ise deploy key veya PAT gerekir):

```bash
git clone https://github.com/Hasanuyarrr/egitim_portali_2.git /opt/secscop/app && chown -R secscop:secscop /opt/secscop
```

Bağımlılıklar (dev bağımlılıkları olmadan):

```bash
cd /opt/secscop/app/agdsecscop_team/server && sudo -u secscop npm ci --omit=dev
```

RDS TLS kök paketi:

```bash
curl -o /etc/ssl/certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

---

## 5. Ortam değişkenleri

`JWT_SECRET` üretin — bu sırrı **hiçbir yere kopyalamayın**, sunucu dışında
saklamayın:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`.env` dosyasını yazın (`RDS_ENDPOINT`, `DB_SIFRESI`, `JWT`, alan adı kısımlarını değiştirin):

```bash
cat > /opt/secscop/app/agdsecscop_team/server/.env <<'EOF'
NODE_ENV=production
PORT=3001

DATABASE_URL=postgresql://secscop:DB_SIFRESI@RDS_ENDPOINT:5432/edunova
DB_CA_CERT_PATH=/etc/ssl/certs/rds-global-bundle.pem

JWT_SECRET=URETTIGINIZ_SIR
JWT_EXPIRES_IN=12h

CORS_ORIGINS=https://portal.alanadiniz.com
TRUST_PROXY=1

UPLOAD_ROOT=/var/lib/secscop/uploads
EOF
chown secscop:secscop /opt/secscop/app/agdsecscop_team/server/.env
chmod 600 /opt/secscop/app/agdsecscop_team/server/.env
```

> Bu beş ayarın hepsi zorunludur:
> - `NODE_ENV=production` → HSTS açılır, DB bağlantısında TLS doğrulanır
> - `DB_CA_CERT_PATH` → yoksa RDS'e TLS bağlantısı sertifika hatası verebilir
> - `CORS_ORIGINS` → üretimde boşsa **sunucu açılmaz** (bilinçli)
> - `TRUST_PROXY=1` → nginx arkasında gerçek istemci IP'si; yoksa hız
>   sınırlayıcılar tüm trafiği tek IP sanar ve herkesi birlikte kilitler
> - `UPLOAD_ROOT` → kod dizini dışında; `git pull` yüklenen dosyaları silmesin

Şifre veya sır `.env`'e girsin istemiyorsanız **SSM Parameter Store**
(SecureString) kullanıp servisi başlatmadan önce çevre değişkenine yazın.

---

## 6. Veritabanı ve servis

Tabloları oluşturun. Seed hesap şifrelerini **siz belirleyin**, yoksa rastgele
üretilir ve yalnızca bir kez ekrana yazılır:

```bash
cd /opt/secscop/app/agdsecscop_team/server && sudo -u secscop SEED_ADMIN_PASSWORD='GucluAdminSifresi123' npm run db:init
```

Çıktıda `✓ Tables created.` görmelisiniz. `the database system is...` benzeri bir
hata alırsanız 10. bölüme bakın.

systemd servisi:

```bash
cat > /etc/systemd/system/secscop.service <<'EOF'
[Unit]
Description=SeCScop egitim portali API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=secscop
Group=secscop
WorkingDirectory=/opt/secscop/app/agdsecscop_team/server
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5

# Sertleştirme
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/secscop/uploads
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now secscop && systemctl status secscop --no-pager
```

Çalıştığını doğrulayın:

```bash
curl -s localhost:3001/api/health
```

`{"ok":true}` dönmeli.

---

## 7. nginx + HTTPS

```bash
cat > /etc/nginx/sites-available/secscop <<'EOF'
server {
    listen 80;
    server_name portal.alanadiniz.com;

    # Ders videoları 500 MB'a kadar; nginx varsayılanı 1 MB'dır.
    client_max_body_size 512M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Büyük video yüklemeleri ve indirmeleri için
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/secscop /etc/nginx/sites-enabled/secscop
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

TLS sertifikası (DNS'in yayılmış olması şart):

```bash
apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d portal.alanadiniz.com --redirect --agree-tos -m siz@alanadiniz.com --no-eff-email
```

certbot nginx yapılandırmasını otomatik günceller ve yenilemeyi zamanlar.
Yenilemeyi test edin:

```bash
certbot renew --dry-run
```

---

## 8. Doğrulama

Kendi makinenizden çalıştırın. **`ALAN` değişkenini kendi alan adınızla değiştirin.**

Sızıntı testi — hepsi `404` dönmeli:

```bash
ALAN=https://portal.alanadiniz.com; for u in /server/.env /Database/edunova.sql /server/index.js /server/routes/auth.js /.gitignore /server/uploads/ctf/x.pdf; do printf "%-40s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' $ALAN$u)"; done
```

Erişilebilir olması gerekenler — hepsi `200`:

```bash
ALAN=https://portal.alanadiniz.com; for u in / /index.html /admin/login.html /api/health; do printf "%-24s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' $ALAN$u)"; done
```

Güvenlik başlıkları (HSTS artık görünmeli):

```bash
curl -sI https://portal.alanadiniz.com | grep -iE "strict-transport|content-security|x-frame|x-content"
```

Yetkisiz API erişimi — `401` dönmeli:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://portal.alanadiniz.com/api/students
```

Ardından tarayıcıdan `/admin/login.html` → admin girişi → panelleri gezin, bir
modül dosyası yükleyip indirin (nginx `client_max_body_size` ve `UPLOAD_ROOT`
birlikte doğrulanır).

---

## 9. Yedekleme ve izleme

**Veritabanı.** RDS otomatik yedeği 7 gün tutuyor. Aylık manuel snapshot:
RDS → Snapshots → Take snapshot.

**Yüklenen dosyalar.** EBS snapshot'ı otomatikleştirin: EC2 → Lifecycle Manager →
günlük snapshot, 7 gün saklama. Alternatif olarak S3'e senkron:

```bash
aws s3 sync /var/lib/secscop/uploads s3://secscop-uploads-yedek/ --delete
```

(EC2 rolüne o bucket için `s3:PutObject`/`s3:DeleteObject` izni ekleyin.)

**Loglar.**

```bash
journalctl -u secscop -f
```

**Uyarı.** CloudWatch → Alarms: EC2 `CPUUtilization > %80`, RDS
`FreeStorageSpace < 2 GB`, `DatabaseConnections` yükselmesi.

---

## 10. Güncelleme akışı

```bash
cd /opt/secscop/app && sudo -u secscop git pull && cd agdsecscop_team/server && sudo -u secscop npm ci --omit=dev && systemctl restart secscop && systemctl status secscop --no-pager
```

`UPLOAD_ROOT` kod dizininin dışında olduğu için `git pull` yüklenen dosyalara
dokunmaz.

---

## 11. Sorun giderme

| Belirti | Sebep / çözüm |
|---------|----------------|
| `✗ Yapılandırma hatası — CORS_ORIGINS zorunludur` | Üretimde bu değişken boş olamaz. `.env`'e tam origin yazın: `https://portal.alanadiniz.com` (sonda `/` yok) |
| `✗ JWT_SECRET ... yer tutucu` | `.env.example`'dan kopyaladınız; yeni sır üretin |
| `self signed certificate in certificate chain` | `DB_CA_CERT_PATH` eksik veya dosya yok. 4. bölümdeki `curl` komutunu tekrar çalıştırın |
| `Connection terminated due to connection timeout` | `secscop-db-sg` içinde 5432 kaynağı `secscop-web-sg` değil. Güvenlik grubunu düzeltin |
| `getaddrinfo ENOTFOUND` | `DATABASE_URL` içindeki RDS endpoint'i yanlış |
| Büyük video yüklerken `413` | nginx `client_max_body_size` düşük; 512M yapıp `systemctl reload nginx` |
| Herkes aynı anda `429` alıyor | `TRUST_PROXY=1` eksik; tüm istekler nginx'in IP'sinden geliyormuş gibi sayılıyor |
| Panelde veri gelmiyor, konsolda 401 | Token süresi doldu (12 saat) ya da şifre değişti; yeniden giriş yapın |
| Yüklenen dosyalar deploy sonrası kayboldu | `UPLOAD_ROOT` ayarlanmamış, varsayılan `server/uploads` kullanılıyor |
| certbot "challenge failed" | DNS henüz yayılmamış ya da 80 portu kapalı |

---

## 12. Yayına almadan önce son kontrol

- [ ] RDS **Public access = No**, 5432 yalnızca `secscop-web-sg`'den
- [ ] SSH 22 hiçbir güvenlik grubunda açık değil (SSM kullanılıyor)
- [ ] `.env` izinleri `600`, sahibi `secscop`
- [ ] `JWT_SECRET` bu sunucuya özel, hiçbir yerde paylaşılmadı
- [ ] Seed admin şifresi değiştirildi, demo öğrenci hesapları silindi veya şifreleri döndürüldü
- [ ] `Database/*.sql` dökümleri sunucuya kopyalanmadı (flag ve hash içeriyor)
- [ ] 8. bölümdeki sızıntı testi tamamen `404` veriyor
- [ ] HTTPS zorunlu, `certbot renew --dry-run` başarılı
- [ ] EBS ve RDS yedekleri zamanlanmış
- [ ] Billing budget uyarısı kurulu

Kalan uygulama seviyesi riskler için:
[agdsecscop_team/server/SECURITY.md](agdsecscop_team/server/SECURITY.md)
