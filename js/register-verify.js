// register.html: validate, email a code, then go to verify.html.
// Your original handler in login-register.js is NOT run here;
// verify.js creates the account after the code is correct.
(function () {
  const ALLOWED_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'email.com'];
  const form = document.getElementById('registerForm');
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const msg = $('regMsg');
  const btn = form.querySelector('button[type="submit"]');

  function say(text, ok) {
    msg.textContent = text;
    msg.className = ok ? 'msg ok' : 'msg';
  }

  function validate(email, pass, again) {
    const m = /^[^\s@]+@([^\s@]+\.[a-z]{2,})$/i.exec(email);
    if (!m || !ALLOWED_DOMAINS.includes(m[1].toLowerCase())) return 'Use a valid email, like name@gmail.com.';
    if (pass.length < 8 || !/[A-Z]/.test(pass) || !/[a-z]/.test(pass) || !/[0-9]/.test(pass) || !/[^A-Za-z0-9\s]/.test(pass)) {
      return 'Password does not meet all the requirements.';
    }
    if (pass !== again) return 'Passwords do not match.';
    if (getUsers()[email] || email === ADMIN_EMAIL) return 'This email is already registered.';
    return '';
  }

  // Capture phase + stopImmediatePropagation: runs instead of the original handler
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    e.stopImmediatePropagation(); // must happen before the first await

    const name = $('regName').value.trim();
    const email = $('regEmail').value.trim().toLowerCase();
    const pass = $('regPass').value;
    const again = $('regConfirm').value;

    await seedAdmin();
    const err = validate(email, pass, again);
    if (err) return say(err);

    btn.disabled = true;
    say('Sending code...', true);
    try {
      const sent = await Verify.send(email, name);
      Verify.save(Object.assign({
        purpose: 'register',
        name: name,
        email: email,
        passHash: await hash(pass) // never store the plain password
      }, sent));
      window.location.href = 'verify.html';
    } catch (err2) {
      console.error(err2);
      say('Could not send the email. Check your EmailJS settings and try again.');
      btn.disabled = false;
    }
  }, true);
})();