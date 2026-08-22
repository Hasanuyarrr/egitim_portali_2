/** Ortak girdi doğrulama kuralları (auth + öğrenci yönetimi aynı politikayı kullanır). */

/** Şifre politikası: en az 10 karakter, en az bir harf ve bir rakam. */
function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 10) {
    return "Şifre en az 10 karakter olmalıdır.";
  }
  if (pw.length > 200) {
    return "Şifre en fazla 200 karakter olabilir.";
  }
  if (!/[A-Za-zĞÜŞİÖÇğüşıöç]/.test(pw) || !/[0-9]/.test(pw)) {
    return "Şifre en az bir harf ve bir rakam içermelidir.";
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(v) {
  return typeof v === "string" && v.length <= 255 && EMAIL_RE.test(v.trim());
}

/** Serbest metin alanları için: tip + uzunluk kontrolü, kırpılmış değeri döndürür. */
function cleanText(v, maxLen) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > maxLen) return null;
  return s;
}

/** Pozitif tamsayı id doğrulaması (route param'ları için). */
function toId(v) {
  const n = Number.parseInt(v, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Sayısal route parametrelerini (:id, :aid, :moduleId …) doğrular.
 * Doğrulanmazsa "abc" gibi değerler doğrudan SQL'e gidip veritabanı
 * hatasıyla 500 üretiyordu; artık temiz bir 400 döner.
 */
function guardNumericParams(router, names) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => {
      if (toId(value) === null) {
        return res.status(400).json({ error: `Geçersiz ${name} parametresi.` });
      }
      next();
    });
  }
}

module.exports = { passwordProblem, isValidEmail, cleanText, toId, guardNumericParams };
