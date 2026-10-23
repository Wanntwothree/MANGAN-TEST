// Shared helpers for the email-code step (EmailJS). Used by
// register-verify.js, login-verify.js and verify.js.
// Needs login-register.js on the page (for hash()).
(function () {
  const CFG = window.EMAILJS_CONFIG;
  emailjs.init({ publicKey: CFG.publicKey });

  const TTL_MS = 10 * 60 * 1000;
  const KEY = 'pendingVerify';

  function makeCode() {
    return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  }

  // Emails a new code. Returns what must be remembered (the code itself is only stored hashed).
  async function send(email, name) {
    const code = makeCode();
    const expires = Date.now() + TTL_MS;
    await emailjs.send(CFG.serviceId, CFG.templateId, {
      to_email: email,
      to_name: name || 'there',
      passcode: code,
      time: new Date(expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    return { codeHash: await hash(code), expires: expires, attempts: 0, lastSent: Date.now() };
  }

  function save(pending) { sessionStorage.setItem(KEY, JSON.stringify(pending)); }
  function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function clear() { sessionStorage.removeItem(KEY); }

  window.Verify = { send: send, save: save, load: load, clear: clear };
})();