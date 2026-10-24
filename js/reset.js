// reset.html: set a new password after the email code was verified.
const resetEmail = sessionStorage.getItem("resetEmail");
if (!resetEmail) window.location.replace("login.html");

function strongPassword(p) {
  return p.length >= 8 &&
    /[A-Z]/.test(p) &&
    /[a-z]/.test(p) &&
    /[0-9]/.test(p) &&
    /[^A-Za-z0-9\s]/.test(p);
}

const newPassEl = document.getElementById("newPass");
const newPass2El = document.getElementById("newPass2");
const matchHint = document.getElementById("matchHint");

function checkMatch() {
  const a = newPassEl.value, b = newPass2El.value;
  newPass2El.classList.remove("bad", "good");
  if (!b) { matchHint.textContent = ""; matchHint.className = "match-hint"; return; }
  if (a === b) {
    matchHint.textContent = "✓ Passwords match";
    matchHint.className = "match-hint good";
    newPass2El.classList.add("good");
  } else {
    matchHint.textContent = "* Passwords do not match";
    matchHint.className = "match-hint bad";
    newPass2El.classList.add("bad");
  }
}

newPassEl.addEventListener("input", checkMatch);
newPass2El.addEventListener("input", checkMatch);

document.getElementById("resetForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  const p1 = document.getElementById("newPass").value;
  const p2 = document.getElementById("newPass2").value;

  if (!strongPassword(p1)) {
    return setMsg("Use 8+ characters with upper and lower case letters, a number, and a symbol.");
  }
  if (p1 !== p2) return setMsg("Passwords do not match.");

  const users = getUsers();
  if (!users[resetEmail]) return setMsg("Account not found.");

  const newHash = await hash(p1);
  if (newHash === users[resetEmail].hash) {
    return setMsg("New password must be different from your old password.");
  }

  users[resetEmail].hash = newHash;
  saveUsers(users);
  sessionStorage.removeItem("resetEmail");

  setMsg("Password changed. Redirecting to log in...", true);
  setTimeout(function () { window.location.href = "login.html"; }, 1200);
});