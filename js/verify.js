// verify.html: enter the code, then finish registering or logging in.
(function () {
  const RESEND_COOLDOWN_S = 60;
  const MAX_ATTEMPTS = 5;

  const $ = (id) => document.getElementById(id);
  const form = $('verifyForm'), info = $('verifyInfo'), codeEl = $('verifyCode');
  const verifyBtn = $('verifyBtn'), resendBtn = $('resendBtn'), backLink = $('backLink');

  let pending = Verify.load();
  let cooldownTimer = null;

  if (!pending) {
    form.style.display = 'none';
    info.innerHTML = 'Nothing to verify. <a href="register.html">Register</a> or <a href="login.html">log in</a> first.';
    return;
  }

  backLink.href = pending.purpose === 'register' ? 'register.html' : 'login.html';
  backLink.addEventListener('click', function () { Verify.clear(); });
  info.textContent = 'We sent a 6-digit code to ' + pending.email + '. It expires in 10 minutes.';
  codeEl.focus();

  function startCooldown(seconds) {
    clearInterval(cooldownTimer);
    let left = seconds;
    resendBtn.disabled = true;
    const tick = () => {
      resendBtn.textContent = left > 0 ? 'Resend in ' + left + 's' : 'Resend code';
      if (left-- <= 0) { clearInterval(cooldownTimer); resendBtn.disabled = false; }
    };
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  // Keep the cooldown if the page was reloaded right after sending
  const sinceSent = Math.floor((Date.now() - pending.lastSent) / 1000);
  startCooldown(Math.max(0, RESEND_COOLDOWN_S - sinceSent));

  resendBtn.addEventListener('click', async function () {
    resendBtn.disabled = true;
    try {
      const sent = await Verify.send(pending.email, pending.name);
      pending = Object.assign(pending, sent);
      Verify.save(pending);
      codeEl.value = '';
      setMsg('A new code was sent.', true);
      startCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      console.error(err);
      setMsg('Could not send the email. Try again.');
      resendBtn.disabled = false;
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const entered = codeEl.value.trim();
    if (!/^\d{6}$/.test(entered)) return setMsg('Enter the 6-digit code.');
    if (Date.now() > pending.expires) return setMsg('Code expired. Click Resend code.');
    if (pending.attempts >= MAX_ATTEMPTS) return setMsg('Too many attempts. Click Resend code.');

    pending.attempts++;
    Verify.save(pending);
    if (await hash(entered) !== pending.codeHash) return setMsg('Incorrect code.');

    verifyBtn.disabled = true;
    await seedAdmin();
    const users = getUsers();

    if (pending.purpose === 'register') {
      if (users[pending.email]) { verifyBtn.disabled = false; return setMsg('This email is already registered.'); }
      users[pending.email] = { name: pending.name, hash: pending.passHash };
      saveUsers(users);
      setMsg('Account created. Welcome, ' + pending.name + '!', true);
      Verify.clear();
      setTimeout(function () { window.location.href = 'login.html'; }, 1000);
    } else {
      if (!users[pending.email]) { verifyBtn.disabled = false; return setMsg('Account not found.'); }
      try { localStorage.setItem('demoCurrentUser', pending.email); } catch (err) {}
      setMsg('Welcome back, ' + pending.name + '!', true);
      const email = pending.email;
      Verify.clear();
      setTimeout(function () {
        window.location.href = email === ADMIN_EMAIL ? 'admin.html' : 'moodSelect.html';
      }, 800);
    }
  });
})();