const test = require("node:test");
const assert = require("node:assert/strict");
const {
  connectionForManualUrl,
  fingerprintsEqual,
  normalizeBaseUrl,
  normalizeFingerprint,
  parseInviteDocument,
} = require("../src/lib/connection-config");

const FINGERPRINT = "0123456789ABCDEF".repeat(4);

test("normalizes an HTTPS host to its exact origin", () => {
  assert.equal(normalizeBaseUrl(" https://26.10.20.30:8443/main.html?q=1 "), "https://26.10.20.30:8443");
  assert.equal(normalizeBaseUrl("https://example.test/"), "https://example.test");
});

test("rejects insecure, credentialed, and malformed host URLs", () => {
  assert.throws(() => normalizeBaseUrl("http://26.10.20.30:8000"), /HTTPS/);
  assert.throws(() => normalizeBaseUrl("https://user:pass@example.test"), /логин|пароль/);
  assert.throws(() => normalizeBaseUrl("not a url"));
});

test("parses a v1 Borotalk connection document with a BOM", () => {
  const connection = parseInviteDocument(`\uFEFF${JSON.stringify({
    schema_version: 1,
    base_url: "https://26.10.20.30:8443/",
    invite_code: "boro-0123456789abcdef",
    certificate_sha256: FINGERPRINT.toLowerCase().match(/../g).join(":"),
  })}`);
  assert.deepEqual(connection, {
    schemaVersion: 1,
    baseUrl: "https://26.10.20.30:8443",
    inviteCode: "boro-0123456789abcdef",
    certificateFingerprint: FINGERPRINT,
    trustedManually: false,
  });
});

test("rejects unsupported or incomplete connection documents", () => {
  assert.throws(() => parseInviteDocument("{}"), /Версия/);
  assert.throws(() => parseInviteDocument(JSON.stringify({
    schema_version: 1,
    base_url: "https://example.test",
    invite_code: "wrong",
    certificate_sha256: FINGERPRINT,
  })), /инвайт/);
});

test("compares SHA-256 fingerprints without formatting differences", () => {
  const colonFingerprint = FINGERPRINT.match(/../g).join(":").toLowerCase();
  assert.equal(normalizeFingerprint(colonFingerprint), FINGERPRINT);
  assert.equal(fingerprintsEqual(FINGERPRINT, colonFingerprint), true);
  assert.equal(fingerprintsEqual(FINGERPRINT, "F".repeat(64)), false);
});

test("manual connections remain unpinned until explicit trust", () => {
  assert.deepEqual(connectionForManualUrl("https://host.test:8443/path"), {
    schemaVersion: 1,
    baseUrl: "https://host.test:8443",
    inviteCode: "",
    certificateFingerprint: "",
    trustedManually: false,
  });
});
