// login.html: check email + password, email a code, then go to verify.html.
(function () {
  const form = document.getElementById('loginForm');
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const msg = $('loginMsg');
  const btn = form.querySelector('button[type="submit"]');

  function say(text, ok) {
    msg.textContent = text;
    msg.className = ok ? 'msg ok' : 'msg';
  }

  form.addEventListener('submit', async function (e) {
    if (form.dataset.skip === '1') return; // admin: let the original handler run
    e.preventDefault();
    e.stopImmediatePropagation(); // must happen before the first await

    await seedAdmin();
    const email = $('loginEmail').value.trim().toLowerCase();
    const user = getUsers()[email];
    if (!user || user.hash !== await hash($('loginPass').value)) {
      return say('Incorrect email or password.');
    }

    // admin@mangan.com isn't a real inbox, so it skips the code
    if (email === ADMIN_EMAIL) {
      form.dataset.skip = '1';
      form.requestSubmit();
      return;
    }

    btn.disabled = true;
    say('Sending code...', true);
    try {
      const sent = await Verify.send(email, user.name);
      Verify.save(Object.assign({ purpose: 'login', name: user.name, email: email }, sent));
      window.location.href = 'verify.html';
    } catch (err) {
      console.error(err);
      say('Could not send the email. Check your EmailJS settings and try again.');
      btn.disabled = false;
    }
  }, true);
})();