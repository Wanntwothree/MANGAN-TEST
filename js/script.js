// ---------- Settings ----------
const ADMIN_EMAIL = "admin@mangan.com";
const ADMIN_PASSWORD = "admin123"; // change this to your own

// ---------- Storage ----------
// Fallback in case the browser blocks localStorage
const memory = { users: {} };

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem("demoUsers")) || {};
  } catch (e) {
    return memory.users;
  }
}

function saveUsers(users) {
  memory.users = users;
  try {
    localStorage.setItem("demoUsers", JSON.stringify(users));
  } catch (e) {}
}

// Scramble the password so it is not stored as plain text
async function hash(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");
}

// Create the admin account once if it doesn't exist yet
async function seedAdmin() {
  const users = getUsers();
  if (!users[ADMIN_EMAIL]) {
    users[ADMIN_EMAIL] = { name: "Admin", hash: await hash(ADMIN_PASSWORD) };
    saveUsers(users);
  }
}
seedAdmin();

// ---------- Page helpers ----------
// Works on both pages: each page has one .msg element
function setMsg(text, ok) {
  const el = document.querySelector(".msg");
  if (!el) return;
  el.textContent = text;
  el.className = ok ? "msg ok" : "msg";
}

// Show or hide a password
function toggle(id, btn) {
  const input = document.getElementById(id);
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  btn.classList.toggle("on", reveal);
  btn.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
}

function resetDemo() {
  try { localStorage.removeItem("demoUsers"); } catch (e) {}
  memory.users = {};
  seedAdmin();
  setMsg("Demo data cleared.", true);
}

// ---------- Register ----------
const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const name = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim().toLowerCase();
    const pass = document.getElementById("regPass").value;
    const again = document.getElementById("regConfirm").value;

    await seedAdmin(); // make sure the admin email can't be taken
    const users = getUsers();

    if (pass !== again) return setMsg("Passwords do not match.");
    if (users[email]) return setMsg("This email is already registered.");

    users[email] = { name: name, hash: await hash(pass) };
    saveUsers(users);

    this.reset();
    setMsg("Account created. Welcome, " + name + "!", true);

    setTimeout(function () {
      window.location.href = "login.html";
    }, 1000);
  });
}

// ---------- Login ----------
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    await seedAdmin();
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const pass = document.getElementById("loginPass").value;
    const user = getUsers()[email];

    if (!user || user.hash !== await hash(pass)) {
      return setMsg("Incorrect email or password.");
    }

    // Remember who is logged in
    try { localStorage.setItem("demoCurrentUser", email); } catch (err) {}

    setMsg("Welcome back, " + user.name + "!", true);

    setTimeout(function () {
      window.location.href = email === ADMIN_EMAIL ? "admin.html" : "moodSelect.html";
    }, 800);
  });
}