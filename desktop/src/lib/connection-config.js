const INVITE_SCHEMA_VERSION = 1;
const INVITE_CODE_PATTERN = /^boro-[a-f0-9]{16}$/i;

function normalizeFingerprint(value) {
  const normalized = String(value || "").replace(/[^a-f0-9]/gi, "").toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    throw new Error("Некорректный SHA-256 fingerprint сертификата.");
  }
  return normalized;
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("Укажите корректный адрес Borotalk.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Borotalk Desktop подключается только по HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Адрес не должен содержать логин или пароль.");
  }
  if (!parsed.hostname) {
    throw new Error("В адресе отсутствует имя хоста.");
  }
  return parsed.origin;
}

function parseInviteDocument(source) {
  let payload;
  try {
    payload = JSON.parse(String(source || "").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Файл подключения повреждён или имеет неверный формат.");
  }
  if (!payload || Number(payload.schema_version) !== INVITE_SCHEMA_VERSION) {
    throw new Error("Версия файла подключения не поддерживается.");
  }
  const inviteCode = String(payload.invite_code || "").trim();
  if (!INVITE_CODE_PATTERN.test(inviteCode)) {
    throw new Error("В файле подключения указан некорректный инвайт-код.");
  }
  return {
    schemaVersion: INVITE_SCHEMA_VERSION,
    baseUrl: normalizeBaseUrl(payload.base_url),
    inviteCode,
    certificateFingerprint: normalizeFingerprint(payload.certificate_sha256),
    trustedManually: false,
  };
}

function fingerprintsEqual(left, right) {
  if (!left || !right) return false;
  try {
    return normalizeFingerprint(left) === normalizeFingerprint(right);
  } catch {
    return false;
  }
}

function connectionForManualUrl(value) {
  return {
    schemaVersion: INVITE_SCHEMA_VERSION,
    baseUrl: normalizeBaseUrl(value),
    inviteCode: "",
    certificateFingerprint: "",
    trustedManually: false,
  };
}

module.exports = {
  INVITE_SCHEMA_VERSION,
  connectionForManualUrl,
  fingerprintsEqual,
  normalizeBaseUrl,
  normalizeFingerprint,
  parseInviteDocument,
};
