var GROK_PAY = {
  priceLabel: "$4.99",
  checkoutUrl: "https://buy.stripe.com/6oU3cu97Wa5B5rPaNsgUM02",
  publicKey:
    "-----BEGIN PUBLIC KEY-----\n" +
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApxXU1bq1KX86WOi14uBz\n" +
    "CN9KGnX9C44RFet/6RD4fKI5qtxyMQps3A1ka/z15V7qaDs5503GEibMNaG5M3kc\n" +
    "/TGhGec4WT9EeVr8wqkFeoGTMv0ZvTPeF6nnDdVgREvvuDV5fz6wZiASxG2UHFHb\n" +
    "cir7sJmEhkyaZpQ4X14lAE2PPUwJpIRLRuz7qa3SyWZFZvLYK4MqNe9FaHH2GF4J\n" +
    "acpyezPcnTNYrknz7H0s6W73NT5nX+lOYShJukqMyhKGeUF587eWRW79X7AvqQCv\n" +
    "e03QRE9E/suL5PXRh6wsfVp+Mr4a9ZYtW0PfR/mpb/qMzhmhZXWqyCzxjhPIGzkl\n" +
    "vQIDAQAB\n" +
    "-----END PUBLIC KEY-----",
};

function unlockBytes(value) {
  var padded = String(value || "") + "=".repeat((4 - (String(value || "").length % 4)) % 4);
  var raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  var bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 255;
  return bytes;
}

function verifyUnlock(code) {
  var parts = String(code || "").trim().split(".");
  if (parts.length !== 2 || !globalThis.crypto || !crypto.subtle) return Promise.resolve(null);
  var pem = GROK_PAY.publicKey.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  var raw;
  try {
    raw = atob(pem);
  } catch (err) {
    return Promise.resolve(null);
  }
  var bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 255;
  return crypto.subtle
    .importKey("spki", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
    .then(function (key) {
      return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unlockBytes(parts[1]), new TextEncoder().encode(parts[0]));
    })
    .then(function (ok) {
      if (!ok) return null;
      var payload = JSON.parse(new TextDecoder().decode(unlockBytes(parts[0])));
      if (!payload || payload.p !== "grok-credits") return null;
      return payload;
    })
    .catch(function () {
      return null;
    });
}
