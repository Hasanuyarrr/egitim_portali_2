/* ============================================================
   SeCScop — script.js
   Theme toggle (dark/light) + Language toggle (TR/EN)
   + Reveal animations + Nav scroll + Counter + Cursor glow
   ============================================================ */

// ─── SVG Icons ──────────────────────────────────────────────
const ICON_MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor"/>
</svg>`;

const ICON_SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.22"/>
  <circle cx="12" cy="12" r="4"/>
  <line x1="12" y1="2"   x2="12" y2="5"/>
  <line x1="12" y1="19"  x2="12" y2="22"/>
  <line x1="2"  y1="12"  x2="5"  y2="12"/>
  <line x1="19" y1="12"  x2="22" y2="12"/>
  <line x1="4.93" y1="4.93"   x2="7.05" y2="7.05"/>
  <line x1="16.95" y1="16.95" x2="19.07" y2="19.07"/>
  <line x1="4.93" y1="19.07"  x2="7.05" y2="16.95"/>
  <line x1="16.95" y1="7.05"  x2="19.07" y2="4.93"/>
</svg>`;

// ─── Translations ────────────────────────────────────────────
const T = {
  tr: {
    /* ── Shared nav ── */
    "nav.home":     "Anasayfa",
    "nav.services": "Hizmetlerimiz",
    "nav.mission":  "Misyonumuz",
    "nav.vision":   "Vizyonumuz",
    "nav.instructor": "Eğitmen",
    "nav.login":    "Giriş Yap",
    "footer.copy":  "© 2026 SeCScop Akademi",

    /* ── index.html ── */
    "idx.hero.label":      "Siber Güvenlik Uzmanlık Programı",
    "idx.hero.h1":         "Tehditleri analiz edin.<br><em>Savunmayı tasarlayın.</em>",
    "idx.hero.p":          "Ağ temellerinden bulut güvenlik mimarisine uzanan müfredat; uygulamalı laboratuvar, CTF ve bug bounty bileşenleriyle desteklenir.",
    "idx.btn.primary":     "Programı İnceleyin",
    "idx.btn.secondary":   "Kariyer Vizyonu",
    "idx.btn.instructor":  "Eğitmen",
    "idx.stat1.desc":      "Canlı lab ve eğitim içeriği (saat)",
    "idx.stat2.desc":      "CTF senaryosu ve atölye",
    "idx.stat3.desc":      "Katılımcı memnuniyeti",
    "idx.stat4.desc":      "Ulusal CTF sıralama hedefi",
    "idx.curriculum.label":"Müfredat",
    "idx.curriculum.title":"Temelden İleri Düzeye<br>Yapılandırılmış Yol",
    "idx.curriculum.sub":  "Ön bilgi gerektirmeyen program; katılımcıları gerçek dünya tehditlerini değerlendirip savunma stratejileri oluşturabilecek düzeye taşır.",
    "idx.track1.label":    "Temel Seviye",
    "idx.track1.title":    "Altyapı & Ağ",
    "idx.track1.li1":      "Bilgisayarlar nasıl haberleşir?",
    "idx.track1.li2":      "TCP/IP, DNS, HTTP/HTTPS, OSI modeli",
    "idx.track1.li3":      "Paket analizi ve Wireshark pratiği",
    "idx.track1.li4":      "Web siteleri nasıl çalışır?",
    "idx.track1.li5":      "Linux kurulum ve terminal kullanımı",
    "idx.track2.label":    "Orta Seviye",
    "idx.track2.title":    "Saldırı & Savunma",
    "idx.track2.li1":      "Ağ içi saldırılar ve MITM senaryoları",
    "idx.track2.li2":      "Zafiyet anlama ve tespit etme",
    "idx.track2.li3":      "Pentest araçları: Nmap, Metasploit, Burp",
    "idx.track2.li4":      "CTF çözüm teknikleri ve writeup yazımı",
    "idx.track2.li5":      "Privilege escalation ve post-exploitation",
    "idx.track3.label":    "İleri Seviye",
    "idx.track3.title":    "Cloud & SOC",
    "idx.track3.li1":      "Cloud'da web sunucusu kurulum & hardening",
    "idx.track3.li2":      "Güvenli ağ mimarisi tasarımı",
    "idx.track3.li3":      "Log toplama ve saldırı izleme",
    "idx.track3.li4":      "Olay müdahale ve denetim izi yönetimi",
    "idx.track3.li5":      "Bug bounty ekiplerine geçiş yol haritası",
    "idx.features.label":  "Neden SeCScop?",
    "idx.features.title":  "Teori ile sınırlı kalmayan<br>uygulamalı model.",
    "idx.features.sub":    "Konular canlı laboratuvarlarla desteklenir. CTF’de öne çıkan katılımcılara sertifika ve bug bounty geçişine yönelik danışmanlık sunulur.",
    "idx.tag1":            "Offensive Security",
    "idx.tag2":            "Blue Team",
    "idx.tag3":            "Cloud Security",
    "idx.feat1.title":     "Laboratuvar ortamı",
    "idx.feat1.p":         "Derslerle uyumlu gerçek makine ve kontrollü zafiyet senaryolarına kesintisiz erişim.",
    "idx.feat2.title":     "CTF hazırlık süreci",
    "idx.feat2.p":         "Haftalık çözüm oturumları, takım kurma ve ulusal yarışmalara yönelik rehberlik.",
    "idx.feat3.title":     "Sertifika ve referans",
    "idx.feat3.p":         "Başarılı katılımcılara sertifika ve kariyer referansı; bug bounty ekosistemine geçişte destek.",
    "idx.feat4.title":     "Bulut güvenlik laboratuvarı",
    "idx.feat4.p":         "Bulut üzerinde kurulum, sertleştirme, mimari tasarım ve log izleme uygulamaları.",
    "idx.feat5.title":     "Mentorluk",
    "idx.feat5.p":         "Sektör deneyimli mentorlarla birebir teknik ve kariyer planlama oturumları.",
    "idx.cta.title":       "Yeni dönem için başvurular açıktır.",
    "idx.cta.btn":         "Başvuru Formu",
    "idx.panel.l1":       '<span class="prompt">$</span> nmap -sV <span class="hl">hedef.edu</span>',
    "idx.panel.l2":       '<span class="prompt">→</span> <span class="hl">443/tcp</span> open ssl/http',
    "idx.panel.l3":       '<span class="prompt">$</span> wireshark -i eth0 -f <span class="hl">tcp port 443</span>',

    /* ── hizmetlerimiz.html ── */
    "hiz.offer.label":     "Hizmet kapsamı",
    "hiz.offer.title":     "Eğitimden kariyere<br>kesintisiz destek.",
    "hiz.offer.sub":       "Yalnızca kayıtlı oturum değil; canlı dersler, ölçülebilir ilerleme ve iş gücünde kullanılabilir yetkinlik önceliklidir.",
    "hiz.svc1.icon":       "01",
    "hiz.svc1.title":      "Öğrenme platformu",
    "hiz.svc1.p":          "Modül, ders ve ilerleme takibi; materyallere her zaman erişim.",
    "hiz.svc2.icon":       "02",
    "hiz.svc2.title":      "Canlı eğitim",
    "hiz.svc2.p":          "Haftalık interaktif oturumlar; soru-cevap ve canlı demo.",
    "hiz.svc3.icon":       "03",
    "hiz.svc3.title":      "Uygulamalı lab",
    "hiz.svc3.p":          "Gerçekçi senaryolar ve kontrollü zafiyet ortamlarında pratik.",
    "hiz.svc4.icon":       "04",
    "hiz.svc4.title":      "CTF & yarışma",
    "hiz.svc4.p":          "Kamp süreci, takım çalışması ve yarışma stratejisi.",
    "hiz.svc5.icon":       "05",
    "hiz.svc5.title":      "Ölçme & sınav",
    "hiz.svc5.p":          "Bilgiyi pekiştiren değerlendirmeler ve modül sınavları.",
    "hiz.svc6.icon":       "06",
    "hiz.svc6.title":      "Kariyer & sertifika",
    "hiz.svc6.p":          "Mentorluk, başarı sertifikası ve sektöre geçiş desteği.",

    "hiz.hero.label":      "Program ve hizmetler",
    "hiz.hero.h1":         "Sistematik ve uygulamalı<br><em>siber güvenlik eğitimi.</em>",
    "hiz.hero.p":          "Offensive, defensive ve cloud odaklı modüller; saha becerileri ve kariyer hedefleriyle uyumludur.",
    "hiz.btn.primary":     "Başvur",
    "hiz.btn.secondary":   "Kariyer vizyonu",
    "hiz.stat1.desc":      "Gerçek lab senaryosu",
    "hiz.stat2.desc":      "CTF kamp oturumu",
    "hiz.stat3.desc":      "Haftalık program süresi",
    "hiz.stat4.desc":      "Lab ortamı erişimi",
    "hiz.modules.label":   "Eğitim Modülleri",
    "hiz.modules.title":   "Seviyeye göre<br>yapılandırılmış içerik.",
    "hiz.track1.label":    "Network & Web",
    "hiz.track1.title":    "Temel Altyapı",
    "hiz.track1.li1":      "Web siteleri nasıl çalışır?",
    "hiz.track1.li2":      "HTTP, HTTPS, DNS, SSL/TLS",
    "hiz.track1.li3":      "Client-server, proxy ve CDN yapısı",
    "hiz.track1.li4":      "Bilgisayarlar arası iletişim temelleri",
    "hiz.track1.li5":      "Wireshark ile paket analizi",
    "hiz.track2.label":    "Offensive Security",
    "hiz.track2.title":    "Saldırı Teknikleri",
    "hiz.track2.li1":      "Ağ içi saldırı simülasyonları",
    "hiz.track2.li2":      "Zafiyet anlama ve tespit etme",
    "hiz.track2.li3":      "Nmap, Metasploit, Burp Suite",
    "hiz.track2.li4":      "CTF çözüm teknikleri",
    "hiz.track2.li5":      "Privilege escalation pratiği",
    "hiz.track3.label":    "Cloud & SOC",
    "hiz.track3.title":    "Savunma & İzleme",
    "hiz.track3.li1":      "Cloud'da web sunucusu kurulumu",
    "hiz.track3.li2":      "Güvenli mimari tasarımı",
    "hiz.track3.li3":      "Log izleme ve SIEM temelleri",
    "hiz.track3.li4":      "Olay müdahale ve denetim izi",
    "hiz.track3.li5":      "Cloud hardening pratikleri",
    "hiz.career.label":    "Kariyer Desteği",
    "hiz.career.title":    "Eğitim bitmez,<br>kariyer başlar.",
    "hiz.career.sub":      "CTF’de öne çıkan katılımcılara sertifika, bug bounty ekosistemine entegrasyon desteği ve iş başvurusu hazırlığında mentorluk sağlanır.",
    "hiz.tag1":            "Sertifika",
    "hiz.tag3":            "Mentörlük",
    "hiz.feat1.title":     "Canlı Ana Eğitim",
    "hiz.feat1.p":         "Network, web, sistem ve güvenlik temellerini kapsayan haftalık canlı dersler.",
    "hiz.feat2.title":     "Offensive Track",
    "hiz.feat2.p":         "Ağ saldırıları, exploit mantığı ve CTF odaklı yoğun uygulamalı atölyeler.",
    "hiz.feat3.title":     "Defensive Track",
    "hiz.feat3.p":         "Log izleme, anomali tespiti, olay müdahale ve SOC operasyon temelleri.",
    "hiz.feat4.title":     "CTF Yarışma Hazırlığı",
    "hiz.feat4.p":         "Takım oluşturma, strateji geliştirme ve ulusal yarışmalara katılım koçluğu.",
    "hiz.feat5.title":     "Bug Bounty Köprüsü",
    "hiz.feat5.p":         "Başarılı öğrencilerin aktif bug bounty topluluklarına geçişini kolaylaştıran mentorluk programı.",
    "hiz.cta.title":       "Kariyer yolculuğunuza başvuru ile adım atın.",
    "hiz.cta.btn":         "Kayıt",

    /* ── misyonumuz.html ── */
    "mis.hero.label":      "Misyonumuz",
    "mis.hero.h1":         "Siber güvenliği<br><em>herkes için erişilebilir kılmak.</em>",
    "mis.hero.p":          "Dijital tehditleri anlama ve etkin savunma yetkinliği geliştirmeyi hedefliyoruz. Öğrenme süreci uygulama ile başlar.",
    "mis.approach.label":  "Yaklaşımımız",
    "mis.approach.title":  "Temelden ileri düzeye,<br>adım adım ilerleme.",
    "mis.approach.p":      "İletişim temellerinden başlayarak ağ saldırıları, zafiyet analizi, bulut güvenlik mimarisi ve log izlemeyi kapsayan net bir yol haritası sunuyoruz. Her modülde laboratuvar ve CTF ile bilgi, ölçülebilir beceriye dönüştürülür.",
    "mis.tag1":            "Etik Hacking",
    "mis.tag2":            "Uygulamalı Lab",
    "mis.tag3":            "Ölçülebilir Gelişim",
    "mis.values.label":    "Temel İlkelerimiz",
    "mis.values.title":    "Ne yaptığımız değil,<br>neden yaptığımız.",
    "mis.feat1.title":     "Teori Değil Pratik",
    "mis.feat1.p":         "Her konu gerçek lab senaryolarıyla pekiştirilir. Öğrenci uygulamadan geçmeden bir sonraki modüle geçmez.",
    "mis.feat2.title":     "Etik ve Sorumluluk",
    "mis.feat2.p":         "Tüm eğitim içerikleri etik hacking ilkeleri çerçevesinde tasarlanır. Bilgi, savunma için kullanılır.",
    "mis.feat3.title":     "Topluluk ve Paylaşım",
    "mis.feat3.p":         "Writeup kültürü, bilgi paylaşımı ve takım içi çalışma alışkanlığı her programın temel parçasıdır.",
    "mis.feat4.title":     "Güncel İçerik",
    "mis.feat4.p":         "Tüm müfredat, endüstrideki aktif uzmanlar tarafından sürekli güncellenir. Eski bilgi sunulmaz.",
    "mis.pillar1.title":   "Hedef kitle",
    "mis.pillar1.p":       "Ön bilgisi olmayan adaylardan, alanında derinleşmek isteyen profesyonellere kadar herkes için tanımlı bir başlangıç.",
    "mis.pillar2.title":   "Öğretim modeli",
    "mis.pillar2.p":       "Önce kavram, ardından laboratuvar ve geri bildirim. Ezber yerine tekrarlanabilir uygulama.",
    "mis.pillar3.title":   "Taahhüt",
    "mis.pillar3.p":       "Etik çerçeve, güncel içerik ve ölçülebilir yetkinlik. Bilgi paylaşımı ve topluluk kültürü programın parçasıdır.",
    "mis.cta.title":       "Bu misyona katılmak ister misiniz?",
    "mis.cta.btn":         "Programları Gör",

    /* ── vizyonumuz.html ── */
    "viz.hero.label":      "Vizyonumuz",
    "viz.hero.h1":         "Siber güvenlikte<br><em>referans bir akademi olmak.</em>",
    "viz.hero.p":          "Ulusal ve uluslararası CTF, bug bounty toplulukları ve güvenli bulut operasyonları için nitelikli yetkinlik kazandıran öncü bir akademi olmayı amaçlıyoruz.",
    "viz.hero.cta":        "Programa katıl",
    "viz.hero.secondary":  "Misyonumuz",
    "viz.orbit.cap":       "hedef ufku",
    "viz.pill.ctf":        "CTF",
    "viz.pill.bb":         "Bug bounty",
    "viz.pill.cloud":      "Cloud · SOC",
    "viz.stat1.desc":      "Ulusal CTF derece hedefi",
    "viz.stat2.desc":      "Aktif lab katılımcısı hedefi",
    "viz.stat3.desc":      "Bug bounty hazır mezun",
    "viz.stat4.desc":      "Global büyüme vizyonu",
    "viz.goals.label":     "Gelecek hedefleri",
    "viz.goals.title":     "CTF'den cloud'a,<br>tam bir güvenlik ekosistemi.",
    "viz.goals.p":         "Katılımcılarımızın ulusal CTF sıralamalarında üst dilimlerde yer alması; aktif bug bounty programlarında somut çıktı üretmesi; kurumsal bulut güvenliği rollerinde liderlik etmesi hedeflenmektedir.",
    "viz.goals.highlight": "Müfredat güncellemeleri, laboratuvar kullanım verileri ve mezun geri bildirimi ile stratejimizi sürekli gözden geçiriyoruz.",
    "viz.road.label":      "Yol haritası",
    "viz.road.title":      "Öğrenmeden etkiye<br>dört adım.",
    "viz.road.sub":        "Katılımcı yolculuğu; ölçülebilir aşamalara ayrılmış, sektörle uyumlu bir geçiş modeli izler.",
    "viz.road1.num":       "01",
    "viz.road1.title":     "Sağlam temel",
    "viz.road1.p":         "Ağ, web ve sistem temelleri; güvenli düşünme alışkanlığı.",
    "viz.road2.num":       "02",
    "viz.road2.title":     "Yarışma ve görünürlük",
    "viz.road2.p":         "CTF ve takım deneyimi ile portföy ve referans oluşturma.",
    "viz.road3.num":       "03",
    "viz.road3.title":     "Sektör köprüsü",
    "viz.road3.p":         "Bug bounty, pentest veya blue team yollarında yapılandırılmış geçiş.",
    "viz.road4.num":       "04",
    "viz.road4.title":     "Ölçek ve etki",
    "viz.road4.p":         "Ulusal ve uluslararası standartlarda uzun vadeli büyüme.",
    "viz.pillars.label":   "Stratejik çıktılar",
    "viz.pillars.title":   "Üç odakta<br>ölçülebilir sonuç.",
    "viz.p1.title":        "Yarışma görünürlüğü",
    "viz.p1.p":            "Ulusal CTF sıralamalarında üst dilim ve sürdürülebilir takım kültürü.",
    "viz.p2.title":        "Bug bounty olgunluğu",
    "viz.p2.p":            "Programlarda güvenli ve ölçülebilir bulgular; sorumlu açıklama disiplini.",
    "viz.p3.title":        "Kurumsal operasyon",
    "viz.p3.p":            "Bulut mimarisi, izleme ve olay müdahalede iş gücüne hazır yetkinlik.",
    "viz.strategy.label":  "Stratejik hedefler",
    "viz.strategy.title":  "Bugünün eğitimi,<br>yarının uzmanı.",
    "viz.strategy.lead":   "Aşağıdaki başlıklar müfredat, mentörlük ve iş birlikleri üzerinden paralel yürütülür.",
    "viz.feat1.title":     "CTF başarı ekosistemi",
    "viz.feat1.p":         "Yarışmalara sistematik hazırlık, takım stratejisi ve derece odaklı kamp modeliyle ulusal alanda güçlü bir isim olmak.",
    "viz.feat2.title":     "Bug bounty köprüsü",
    "viz.feat2.p":         "Başarılı öğrencilerin aktif bug bounty ekiplerine geçişini sağlayan yapılandırılmış mentorluk ve ağ sistemi.",
    "viz.feat3.title":     "Cloud-SOC uzmanlığı",
    "viz.feat3.p":         "Cloud güvenlik mimarisi, log izleme ve olay müdahale uzmanlıklarını sektöre kazandırmak.",
    "viz.feat4.title":     "Global standartlar",
    "viz.feat4.p":         "Müfredatı uluslararası güvenlik framework'leri (OWASP, NIST, MITRE ATT&CK) ile sürekli uyumlu tutmak.",
    "viz.feat5.title":     "Erişilebilirlik",
    "viz.feat5.p":         "Burs ve sosyal etki programlarıyla siber güvenlik eğitimine erişimi demokratikleştirmek.",
    "viz.cta.title":       "Bu vizyona ortak olmak ister misiniz?",
    "viz.cta.btn":         "Programa Katıl",

    /* ── egitmen.html ── */
    "egi.hero.label":      "Eğitmen",
    "egi.hero.name":       "Hasan Hüseyin Uyar",
    "egi.hero.role":       "Siber güvenlik eğitmeni",
    "egi.hero.p":          "SeCScop müfredatında ağ güvenliği, saldırı-savunma laboratuvarları ve CTF hazırlığı üzerine çalışıyorum. Amacım, katılımcıların ölçülebilir saha becerisi kazanması.",
    "egi.social.github":   "GitHub",
    "egi.social.linkedin": "LinkedIn",
    "egi.social.medium":   "Medium",
    "egi.social.email":    "E-posta",
    "egi.about.label":     "Hakkımda",
    "egi.about.title":     "Deneyim ve<br>Odak Alanlarım.",
    "egi.about.p1":        "Offensive ve defensive güvenliği birlikte ele alan hibrit bir yaklaşım benimsiyorum. Web uygulamaları, ağ altyapıları ve IoT sistemleri üzerinde zafiyet analizi yapıyor; paket analizi, trafik inceleme ve exploit geliştirme mantığını kontrollü lab ortamlarında uyguluyorum.",
    "egi.about.p2":        "Red team perspektifiyle saldırı yüzeyi keşfi, zafiyet zincirleme ve istismar süreçlerine odaklanırken; blue team tarafında log analizi, temel SOC operasyonları ve olay korelasyonu üzerine çalışıyorum.",
    "egi.about.p3":        "CTF süreçlerinde aktif rol alarak takım koordinasyonu, görev dağılımı ve write-up disiplini ile öğrenilen bilgiyi kalıcı hale getirmeye önem veriyorum.",
    "egi.expertise.label": "Uzmanlık Alanları",
    "egi.expertise.title": "Penetrasyon, savunma ve eğitim tasarımı.",
    "egi.expertise.sub":   "Saha testleri, SOC temelleri ve müfredatın bir arada yürüdüğü çalışma modeli.",
    "egi.tag1":            "Penetrasyon Testi",
    "egi.tag2":            "Blue Team",
    "egi.tag3":            "Eğitim Tasarımı",
    "egi.skill1.title":    "Penetrasyon Testi",
    "egi.skill1.p":        "Web ve ağ tabanlı sistemlerde zafiyet tespiti, exploit senaryoları geliştirme ve raporlama süreçleri.",
    "egi.skill2.title":    "Blue Team",
    "egi.skill2.p":        "Log analizi, temel SIEM yaklaşımı, anomali tespiti ve olay müdahale süreçlerine giriş seviyesinde operasyonel deneyim.",
    "egi.skill3.title":    "Eğitim Tasarımı ve Aktarımı",
    "egi.skill3.p":        "Siber güvenlik eğitimlerini teorik anlatım + uygulamalı lab + gerçek senaryo kurgusu şeklinde tasarlama ve sunma.",
    "egi.approach.label":  "Eğitim Yaklaşımı",
    "egi.approach.title":  "Canlı ders, laboratuvar ve yarışma.",
    "egi.approach.sub":    "İçerik üretimi, araçlarla pratik ve CTF ile pekiştirme üçlüsü.",
    "egi.app1.title":      "Canlı Eğitim & İçerik Geliştirme",
    "egi.app1.p":          "Canlı dersler, demo senaryoları ve uygulamalı lab ortamlarını müfredat ile hizalayarak katılımcı seviyesine uygun içerikler oluşturuyorum. Eğitim sonrası geri bildirimleri analiz ederek içerikleri iteratif şekilde geliştiriyorum.",
    "egi.app2.title":      "Uygulama Pratiği",
    "egi.app2.p":          "<strong>Araç ve Teknikler.</strong> Nmap, Burp Suite, Wireshark, Metasploit gibi araçlarla etik ve kontrollü ortamlarda tekrarlanabilir senaryolar geliştiriyorum. Gerçek dünya saldırı vektörlerini simüle ederek pratik yetkinlik kazanılmasını hedefliyorum.",
    "egi.app3.title":      "Yarışma ve CTF Deneyimi",
    "egi.app3.p":          "CTF yarışmalarında web, network ve misc kategorilerinde aktif olarak yer alıyorum. Takım içi rol dağılımı, zaman yönetimi ve problem çözme stratejileri üzerine çalışıyorum. Yarışma sonrası write-up hazırlayarak öğrenilen teknikleri dokümante ediyor ve bilgi paylaşımını önceliklendiriyorum.",
    "egi.port.label":      "Portföy",
    "egi.port.title":      "Seçili Çalışmalar<br>ve Bağlantılar.",
    "egi.port.sub":        "Açık kaynak depolar, teknik yazılar ve paylaşılan eğitim çıktıları; CTF ve ek materyal bağlantılarını bu alandan genişletebilirsiniz.",
    "egi.p1.title":        "GitHub",
    "egi.p1.p":            "Açık kaynak projeler, fork’lar ve güvenlik araçları.",
    "egi.p2.title":        "CTF & writeup",
    "egi.p2.p":            "Yarışma çözümleri veya CTFtime profiliniz için bağlantı ekleyin.",
    "egi.p3.title":        "Eğitim içeriği",
    "egi.p3.p":            "Ders notları, video serisi veya workshop materyalleri.",
    "egi.p4.title":        "Medium",
    "egi.p4.p":            "Siber güvenlik ve teknik yazılar.",
    "egi.cta.title":       "Programa katılmak ister misiniz?",
    "egi.cta.btn":         "Başvuru Formu",
  },

  en: {
    /* ── Shared nav ── */
    "nav.home":     "Home",
    "nav.services": "Services",
    "nav.mission":  "Our Mission",
    "nav.vision":   "Our Vision",
    "nav.instructor": "Instructor",
    "nav.login":    "Log In",
    "footer.copy":  "© 2026 SeCScop Academy",

    /* ── index.html ── */
    "idx.hero.label":      "Cybersecurity Expert Program",
    "idx.hero.h1":         "Analyze threats.<br><em>Engineer the defense.</em>",
    "idx.hero.p":          "A structured curriculum from network fundamentals to cloud security architecture, supported by hands-on labs, CTF practice, and bug bounty pathways.",
    "idx.btn.primary":     "View Program",
    "idx.btn.secondary":   "Career Vision",
    "idx.btn.instructor":  "Instructor",
    "idx.stat1.desc":      "Live lab and training hours",
    "idx.stat2.desc":      "CTF scenarios and workshops",
    "idx.stat3.desc":      "Participant satisfaction",
    "idx.stat4.desc":      "National CTF ranking goal",
    "idx.curriculum.label":"Curriculum",
    "idx.curriculum.title":"From Foundations to Advanced<br>A Structured Path",
    "idx.curriculum.sub":  "No prior experience required. The program develops the ability to assess real-world threats and design proportionate defenses.",
    "idx.track1.label":    "Beginner Level",
    "idx.track1.title":    "Infrastructure & Networks",
    "idx.track1.li1":      "How do computers communicate?",
    "idx.track1.li2":      "TCP/IP, DNS, HTTP/HTTPS, OSI model",
    "idx.track1.li3":      "Packet analysis with Wireshark",
    "idx.track1.li4":      "How do websites work?",
    "idx.track1.li5":      "Linux setup and terminal usage",
    "idx.track2.label":    "Intermediate Level",
    "idx.track2.title":    "Attack & Defense",
    "idx.track2.li1":      "In-network attacks and MITM scenarios",
    "idx.track2.li2":      "Understanding and detecting vulnerabilities",
    "idx.track2.li3":      "Pentest tools: Nmap, Metasploit, Burp",
    "idx.track2.li4":      "CTF solving techniques and writeup writing",
    "idx.track2.li5":      "Privilege escalation and post-exploitation",
    "idx.track3.label":    "Advanced Level",
    "idx.track3.title":    "Cloud & SOC",
    "idx.track3.li1":      "Web server deployment & hardening on cloud",
    "idx.track3.li2":      "Secure network architecture design",
    "idx.track3.li3":      "Log collection and attack monitoring",
    "idx.track3.li4":      "Incident response and audit trail management",
    "idx.track3.li5":      "Roadmap to joining bug bounty teams",
    "idx.features.label":  "Why SeCScop?",
    "idx.features.title":  "Beyond lectures:<br>a hands-on operating model.",
    "idx.features.sub":    "Topics are reinforced in live labs. Standout CTF participants receive certificates and guidance for entering bug bounty programs.",
    "idx.tag1":            "Offensive Security",
    "idx.tag2":            "Blue Team",
    "idx.tag3":            "Cloud Security",
    "idx.feat1.title":     "Lab environment",
    "idx.feat1.p":         "Always-on access to real systems and controlled vulnerability scenarios aligned with each module.",
    "idx.feat2.title":     "CTF preparation track",
    "idx.feat2.p":         "Weekly solve sessions, team formation, and coaching oriented toward national competitions.",
    "idx.feat3.title":     "Certificates and references",
    "idx.feat3.p":         "Formal recognition for high performers, plus structured support toward bug bounty engagement.",
    "idx.feat4.title":     "Cloud security lab",
    "idx.feat4.p":         "Deployment, hardening, architecture, and log monitoring exercises in cloud environments.",
    "idx.feat5.title":     "Mentorship",
    "idx.feat5.p":         "One-to-one technical and career planning sessions with practitioners from industry.",
    "idx.cta.title":       "Applications are open for the upcoming intake.",
    "idx.cta.btn":         "Application form",
    "idx.panel.l1":       '<span class="prompt">$</span> nmap -sV <span class="hl">target.edu</span>',
    "idx.panel.l2":       '<span class="prompt">→</span> <span class="hl">443/tcp</span> open ssl/http',
    "idx.panel.l3":       '<span class="prompt">$</span> wireshark -i eth0 -f <span class="hl">tcp port 443</span>',

    /* ── hizmetlerimiz.html ── */
    "hiz.offer.label":     "Service scope",
    "hiz.offer.title":     "From training to career,<br>continuous support.",
    "hiz.offer.sub":       "More than recorded content: live delivery, measurable progress, and workplace-relevant skills.",
    "hiz.svc1.icon":       "01",
    "hiz.svc1.title":      "Learning platform",
    "hiz.svc1.p":          "Modules, lessons and progress tracking with always-on access to materials.",
    "hiz.svc2.icon":       "02",
    "hiz.svc2.title":      "Live training",
    "hiz.svc2.p":          "Weekly interactive sessions with Q&A and live demos.",
    "hiz.svc3.icon":       "03",
    "hiz.svc3.title":      "Hands-on labs",
    "hiz.svc3.p":          "Real scenarios and vulnerable environments to build muscle memory.",
    "hiz.svc4.icon":       "04",
    "hiz.svc4.title":      "CTF & competitions",
    "hiz.svc4.p":          "Camp format, teamwork and competition strategy.",
    "hiz.svc5.icon":       "05",
    "hiz.svc5.title":      "Assessment & exams",
    "hiz.svc5.p":          "Reinforcing quizzes and module exams that measure understanding.",
    "hiz.svc6.icon":       "06",
    "hiz.svc6.title":      "Career & certificates",
    "hiz.svc6.p":          "Mentorship, achievement certificates and industry transition support.",

    "hiz.hero.label":      "Programs and services",
    "hiz.hero.h1":         "Structured, hands-on<br><em>cybersecurity education.</em>",
    "hiz.hero.p":          "Offensive, defensive, and cloud-focused tracks aligned with operational skills and career outcomes.",
    "hiz.btn.primary":     "Apply",
    "hiz.btn.secondary":   "Career vision",
    "hiz.stat1.desc":      "Real lab scenarios",
    "hiz.stat2.desc":      "CTF camp sessions",
    "hiz.stat3.desc":      "Program duration (weeks)",
    "hiz.stat4.desc":      "Lab environment access",
    "hiz.modules.label":   "Training Modules",
    "hiz.modules.title":   "Content organized<br>by proficiency level.",
    "hiz.track1.label":    "Network & Web",
    "hiz.track1.title":    "Core Infrastructure",
    "hiz.track1.li1":      "How do websites work?",
    "hiz.track1.li2":      "HTTP, HTTPS, DNS, SSL/TLS",
    "hiz.track1.li3":      "Client-server, proxy and CDN architecture",
    "hiz.track1.li4":      "Fundamentals of computer communication",
    "hiz.track1.li5":      "Packet analysis with Wireshark",
    "hiz.track2.label":    "Offensive Security",
    "hiz.track2.title":    "Attack Techniques",
    "hiz.track2.li1":      "In-network attack simulations",
    "hiz.track2.li2":      "Understanding and detecting vulnerabilities",
    "hiz.track2.li3":      "Nmap, Metasploit, Burp Suite",
    "hiz.track2.li4":      "CTF solving techniques",
    "hiz.track2.li5":      "Privilege escalation practice",
    "hiz.track3.label":    "Cloud & SOC",
    "hiz.track3.title":    "Defense & Monitoring",
    "hiz.track3.li1":      "Web server deployment on cloud",
    "hiz.track3.li2":      "Secure architecture design",
    "hiz.track3.li3":      "Log monitoring and SIEM fundamentals",
    "hiz.track3.li4":      "Incident response and audit trail",
    "hiz.track3.li5":      "Cloud hardening practices",
    "hiz.career.label":    "Career Support",
    "hiz.career.title":    "Training ends,<br>career begins.",
    "hiz.career.sub":      "Strong CTF performers receive certificates, bug bounty onboarding support, and application coaching with a dedicated mentor.",
    "hiz.tag1":            "Certificate",
    "hiz.tag3":            "Mentorship",
    "hiz.feat1.title":     "Live Core Training",
    "hiz.feat1.p":         "Weekly live sessions covering network, web, system and security fundamentals.",
    "hiz.feat2.title":     "Offensive Track",
    "hiz.feat2.p":         "Intensive hands-on workshops focused on network attacks, exploit logic and CTF.",
    "hiz.feat3.title":     "Defensive Track",
    "hiz.feat3.p":         "Log monitoring, anomaly detection, incident response and SOC operations fundamentals.",
    "hiz.feat4.title":     "CTF Competition Prep",
    "hiz.feat4.p":         "Team formation, strategy development and coaching for national competition participation.",
    "hiz.feat5.title":     "Bug Bounty Bridge",
    "hiz.feat5.p":         "Structured mentorship and networking to help successful students transition to active bug bounty communities.",
    "hiz.cta.title":       "Begin your trajectory with an application.",
    "hiz.cta.btn":         "Register",

    /* ── misyonumuz.html ── */
    "mis.hero.label":      "Our Mission",
    "mis.hero.h1":         "Making cybersecurity<br><em>accessible for everyone.</em>",
    "mis.hero.p":          "We develop the ability to understand digital threats and respond effectively. Learning begins with practice.",
    "mis.approach.label":  "Our Approach",
    "mis.approach.title":  "From foundations to advanced,<br>step by step.",
    "mis.approach.p":      "Starting from how systems communicate, we cover in-network attacks, vulnerability analysis, cloud security architecture, and log monitoring. Each module uses labs and CTF-style work to turn knowledge into measurable skill.",
    "mis.tag1":            "Ethical Hacking",
    "mis.tag2":            "Hands-on Lab",
    "mis.tag3":            "Measurable Growth",
    "mis.values.label":    "Core Principles",
    "mis.values.title":    "Not what we do —<br>why we do it.",
    "mis.feat1.title":     "Practice Over Theory",
    "mis.feat1.p":         "Every topic is reinforced with real lab scenarios. Students don't advance to the next module without completing hands-on work.",
    "mis.feat2.title":     "Ethics and Responsibility",
    "mis.feat2.p":         "All training content is designed within the framework of ethical hacking principles. Knowledge is used for defense.",
    "mis.feat3.title":     "Community and Sharing",
    "mis.feat3.p":         "Writeup culture, knowledge sharing and teamwork habits are core parts of every program.",
    "mis.feat4.title":     "Up-to-date Content",
    "mis.feat4.p":         "All curriculum is continuously updated by active industry experts. No outdated material is presented.",
    "mis.pillar1.title":   "Audience",
    "mis.pillar1.p":       "From first-time learners to practitioners deepening specialization — everyone starts from a defined baseline.",
    "mis.pillar2.title":   "Instructional model",
    "mis.pillar2.p":       "Concepts first, then labs and feedback. Emphasis on repeatable practice rather than memorization.",
    "mis.pillar3.title":   "Commitment",
    "mis.pillar3.p":       "Ethical scope, up-to-date material, and measurable competence. Community and knowledge sharing are built into the program.",
    "mis.cta.title":       "Would you like to join this mission?",
    "mis.cta.btn":         "View Programs",

    /* ── vizyonumuz.html ── */
    "viz.hero.label":      "Our Vision",
    "viz.hero.h1":         "Becoming a<br><em>reference cybersecurity academy.</em>",
    "viz.hero.p":          "Our aim is to be a leading academy that develops qualified talent for national and international CTF outcomes, bug bounty ecosystems, and secure cloud operations.",
    "viz.hero.cta":        "Join the program",
    "viz.hero.secondary":  "Our mission",
    "viz.orbit.cap":       "target horizon",
    "viz.pill.ctf":        "CTF",
    "viz.pill.bb":         "Bug bounty",
    "viz.pill.cloud":      "Cloud · SOC",
    "viz.stat1.desc":      "National CTF ranking target",
    "viz.stat2.desc":      "Active lab participant target",
    "viz.stat3.desc":      "Bug bounty-ready graduates",
    "viz.stat4.desc":      "Global growth vision",
    "viz.goals.label":     "Future Goals",
    "viz.goals.title":     "From CTF to cloud,<br>a full security ecosystem.",
    "viz.goals.p":         "We target top-tier national CTF placement, tangible outcomes in active bug bounty programs, and leadership roles in enterprise cloud security.",
    "viz.goals.highlight": "Curriculum revisions, lab utilization data, and alumni feedback continuously inform our strategic direction.",
    "viz.road.label":      "Roadmap",
    "viz.road.title":      "From learning to impact<br>in four steps.",
    "viz.road.sub":        "The participant journey follows measurable stages and an industry-aligned transition model.",
    "viz.road1.num":       "01",
    "viz.road1.title":     "Solid foundations",
    "viz.road1.p":         "Network, web and systems basics; habits of secure thinking.",
    "viz.road2.num":       "02",
    "viz.road2.title":     "Competition & visibility",
    "viz.road2.p":         "CTF and team experience to build portfolio and references.",
    "viz.road3.num":       "03",
    "viz.road3.title":     "Industry bridge",
    "viz.road3.p":         "Structured paths into bug bounty, pentesting or blue team roles.",
    "viz.road4.num":       "04",
    "viz.road4.title":     "Scale & impact",
    "viz.road4.p":         "Long-term growth aligned with national and international standards.",
    "viz.pillars.label":   "Strategic outcomes",
    "viz.pillars.title":   "Three focus areas,<br>measurable results.",
    "viz.p1.title":        "Competition visibility",
    "viz.p1.p":            "Top-tier national CTF placement and sustainable team culture.",
    "viz.p2.title":        "Bug bounty maturity",
    "viz.p2.p":            "Safe, measurable findings in programs with responsible disclosure discipline.",
    "viz.p3.title":        "Enterprise operations",
    "viz.p3.p":            "Workforce-ready skills in cloud architecture, monitoring, and incident response.",
    "viz.strategy.label":  "Strategic objectives",
    "viz.strategy.title":  "Today's training,<br>tomorrow's expert.",
    "viz.strategy.lead":   "The themes below run in parallel across curriculum, mentorship, and partnerships.",
    "viz.feat1.title":     "CTF success ecosystem",
    "viz.feat1.p":         "Becoming a strong national name through systematic competition preparation, team strategy and ranking-focused camp models.",
    "viz.feat2.title":     "Bug bounty bridge",
    "viz.feat2.p":         "Structured mentorship and networking system enabling successful students to transition to active bug bounty teams.",
    "viz.feat3.title":     "Cloud-SOC expertise",
    "viz.feat3.p":         "Delivering cloud security architecture, log monitoring and incident response specialists to the industry.",
    "viz.feat4.title":     "Global standards",
    "viz.feat4.p":         "Continuously aligning the curriculum with international security frameworks (OWASP, NIST, MITRE ATT&CK).",
    "viz.feat5.title":     "Accessibility",
    "viz.feat5.p":         "Democratizing access to cybersecurity education through scholarships and social impact programs.",
    "viz.cta.title":       "Would you like to align with this vision?",
    "viz.cta.btn":         "Join the Program",

    /* ── egitmen.html ── */
    "egi.hero.label":      "Instructor",
    "egi.hero.name":       "Hasan Hüseyin Uyar",
    "egi.hero.role":       "Cybersecurity instructor",
    "egi.hero.p":          "I focus on network security, attack–defense labs, and CTF preparation in the SeCScop curriculum. My goal is measurable, hands-on skill for every participant.",
    "egi.social.github":   "GitHub",
    "egi.social.linkedin": "LinkedIn",
    "egi.social.medium":   "Medium",
    "egi.social.email":    "Email",
    "egi.about.label":     "About",
    "egi.about.title":     "Experience and<br>Focus Areas.",
    "egi.about.p1":        "I take a hybrid approach that treats offensive and defensive security as one practice. I perform vulnerability analysis on web applications, network infrastructure, and IoT systems, applying packet analysis, traffic review, and exploit development logic in controlled lab environments.",
    "egi.about.p2":        "From a red team angle I focus on attack-surface discovery, vulnerability chaining, and exploitation workflows; on the blue team side I work on log analysis, foundational SOC operations, and event correlation.",
    "egi.about.p3":        "In CTF I stay actively involved, emphasizing team coordination, task distribution, and write-up discipline so lessons become lasting knowledge.",
    "egi.expertise.label": "Areas of expertise",
    "egi.expertise.title": "Offense, defense, and curriculum design.",
    "egi.expertise.sub":   "A model that combines field testing, SOC fundamentals, and structured learning.",
    "egi.tag1":            "Penetration testing",
    "egi.tag2":            "Blue team",
    "egi.tag3":            "Curriculum design",
    "egi.skill1.title":    "Penetration testing",
    "egi.skill1.p":        "Vulnerability identification on web- and network-based systems, developing exploit scenarios, and reporting workflows.",
    "egi.skill2.title":    "Blue team",
    "egi.skill2.p":        "Hands-on experience at an introductory level with log analysis, basic SIEM thinking, anomaly detection, and incident response processes.",
    "egi.skill3.title":    "Curriculum design & delivery",
    "egi.skill3.p":        "Designing and delivering cybersecurity training as theory, hands-on labs, and realistic scenario design.",
    "egi.approach.label":  "Teaching approach",
    "egi.approach.title":  "Live sessions, labs, and competitions.",
    "egi.approach.sub":    "Content delivery, hands-on tooling, and reinforcement through CTF.",
    "egi.app1.title":      "Live teaching & content development",
    "egi.app1.p":          "Aligning live sessions, demos, and hands-on labs with the syllabus to match participant level. I iterate content using post-session feedback.",
    "egi.app2.title":      "Hands-on practice",
    "egi.app2.p":          "<strong>Tools and techniques.</strong> I build repeatable scenarios with Nmap, Burp Suite, Wireshark, and Metasploit in ethical, controlled environments, simulating real-world attack vectors to grow practical skill.",
    "egi.app3.title":      "Competition & CTF experience",
    "egi.app3.p":          "I actively compete in web, network, and misc categories. I focus on in-team role split, time management, and problem-solving strategy. After events I document techniques in write-ups and prioritize knowledge sharing.",
    "egi.port.label":      "Portfolio",
    "egi.port.title":      "Selected Projects<br>and Links.",
    "egi.port.sub":        "Open-source repositories, technical writing, and shared training outputs; extend this section with CTF and additional material links as you add them.",
    "egi.p1.title":        "GitHub",
    "egi.p1.p":            "Open-source projects, forks, and security tooling.",
    "egi.p2.title":        "CTF & writeups",
    "egi.p2.p":            "Add a link to your writeups or CTFtime profile.",
    "egi.p3.title":        "Training content",
    "egi.p3.p":            "Notes, video series, or workshop materials.",
    "egi.p4.title":        "Medium",
    "egi.p4.p":            "Cybersecurity and technical writing.",
    "egi.cta.title":       "Want to join the program?",
    "egi.cta.btn":         "Application form",
  },
};

// ─── State ──────────────────────────────────────────────────
let lang  = localStorage.getItem("lang")  || "tr";
let theme = localStorage.getItem("theme") || "dark";

// ─── Apply Theme ─────────────────────────────────────────────
function applyTheme(t) {
  theme = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem("theme", t);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.innerHTML = t === "dark" ? ICON_MOON : ICON_SUN;
}

// ─── Apply Language ──────────────────────────────────────────
function applyLang(l) {
  lang = l;
  document.documentElement.lang = l === "tr" ? "tr" : "en";
  localStorage.setItem("lang", l);

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const val = T[l][key];
    if (val !== undefined) el.innerHTML = val;
  });

  const langBtn = document.getElementById("langToggle");
  if (langBtn) langBtn.textContent = l === "tr" ? "EN" : "TR";
}

// ─── Init ────────────────────────────────────────────────────
applyTheme(theme);
applyLang(lang);

// ─── Toggle Buttons ──────────────────────────────────────────
document.getElementById("themeToggle")?.addEventListener("click", () => {
  applyTheme(theme === "dark" ? "light" : "dark");
});

document.getElementById("langToggle")?.addEventListener("click", () => {
  applyLang(lang === "tr" ? "en" : "tr");
});

// ─── Staggered reveal on scroll ─────────────────────────────
const reveals = document.querySelectorAll(".reveal");
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const delay = parseFloat(el.dataset.delay || 0);
        setTimeout(() => el.classList.add("visible"), delay * 1000);
        revealObserver.unobserve(el);
      }
    });
  },
  { threshold: 0.06, rootMargin: "0px 0px -40px 0px" }
);
reveals.forEach((el) => revealObserver.observe(el));

// ─── Navbar scroll state ─────────────────────────────────────
const nav = document.querySelector(".site-nav");
if (nav) {
  const update = () => nav.classList.toggle("scrolled", window.scrollY > 20);
  window.addEventListener("scroll", update, { passive: true });
  update();
}

// ─── Animated counters ───────────────────────────────────────
function animateCounter(el) {
  const num = parseFloat(el.dataset.target);
  if (isNaN(num)) return;
  const duration = 1400;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.firstChild.textContent = Math.round(eased * num);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const statNums = document.querySelectorAll(".stat-num[data-target]");
const counterObs = new IntersectionObserver(
  (entries) => entries.forEach((e) => { if (e.isIntersecting) { animateCounter(e.target); counterObs.unobserve(e.target); } }),
  { threshold: 0.5 }
);
statNums.forEach((el) => counterObs.observe(el));

// ─── Mobile nav toggle ───────────────────────────────────────
const toggle = document.getElementById("navToggle");
const links  = document.getElementById("navLinks");

if (toggle && links) {
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.classList.toggle("open", open);
  });
  document.addEventListener("click", (e) => {
    if (!toggle.contains(e.target) && !links.contains(e.target)) {
      links.classList.remove("open");
      toggle.classList.remove("open");
    }
  });
}

// ─── Cursor glow ─────────────────────────────────────────────
const glow = document.createElement("div");
Object.assign(glow.style, {
  position: "fixed",
  width: "360px",
  height: "360px",
  borderRadius: "50%",
  background: "radial-gradient(circle, rgba(199,48,80,0.07) 0%, transparent 70%)",
  pointerEvents: "none",
  zIndex: "0",
  transform: "translate(-50%, -50%)",
  left: "-999px",
  top: "-999px",
  transition: "left 0.14s ease, top 0.14s ease",
  willChange: "left, top",
});
document.body.appendChild(glow);
window.addEventListener("mousemove", (e) => {
  glow.style.left = e.clientX + "px";
  glow.style.top  = e.clientY + "px";
}, { passive: true });
