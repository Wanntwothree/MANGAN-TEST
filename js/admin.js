// ---------- Settings ----------
const ADMIN_EMAIL = "admin@mangan.com";
const COOLDOWN = 3; // seconds before "Yes" can be clicked

// ---------- Guard (backup for the one in admin.html) ----------
try {
  if (localStorage.getItem("demoCurrentUser") !== ADMIN_EMAIL) {
    window.location.replace("login.html");
  }
} catch (e) {
  window.location.replace("login.html");
}

// ---------- Storage (same key as script.js) ----------
function getUsers() {
  try {
    return JSON.parse(localStorage.getItem("demoUsers")) || {};
  } catch (e) {
    return {};
  }
}

function saveUsers(users) {
  try {
    localStorage.setItem("demoUsers", JSON.stringify(users));
  } catch (e) {}
}

let users = getUsers();

// ---------- Table ----------
function render() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  const tbody = document.getElementById("rows");
  tbody.textContent = "";

  // Hide the admin account from the list
  const allEmails = Object.keys(users).filter(function (e) {
    return e !== ADMIN_EMAIL;
  });

  const emails = allEmails.filter(function (e) {
    const name = (users[e].name || "").toLowerCase();
    return e.toLowerCase().includes(q) || name.includes(q);
  });

  emails.forEach(function (email, i) {
    const name = users[email].name || "Unnamed";
    const tr = document.createElement("tr");

    const tdNum = document.createElement("td");
    tdNum.textContent = i + 1;

    const tdUser = document.createElement("td");
    const who = document.createElement("div");
    who.className = "who";
    const av = document.createElement("div");
    av.className = "av";
    av.textContent = name.charAt(0).toUpperCase();
    const nm = document.createElement("span");
    nm.textContent = name;
    who.append(av, nm);
    tdUser.appendChild(who);

    const tdEmail = document.createElement("td");
    tdEmail.textContent = email;

    const tdAct = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "del";
    btn.type = "button";
    btn.textContent = "Remove";
    btn.addEventListener("click", function () {
      openConfirm(name, function () {
        delete users[email];
        saveUsers(users);
        render();
      });
    });
    tdAct.appendChild(btn);

    tr.append(tdNum, tdUser, tdEmail, tdAct);
    tbody.appendChild(tr);
  });

  document.getElementById("statTotal").textContent = allEmails.length;
  document.getElementById("statShown").textContent = emails.length;
  document.getElementById("empty").classList.toggle("hidden", emails.length > 0);
}

// ---------- Confirm popup with cooldown ----------
let timer = null;
let onYes = null;
const overlay = document.getElementById("overlay");
const yesBtn = document.getElementById("yes");

function closeConfirm() {
  clearInterval(timer);
  overlay.classList.add("hidden");
  onYes = null;
}

function openConfirm(name, callback) {
  onYes = callback;
  document.getElementById("mText").textContent =
    "Remove " + name + "? This can't be undone.";

  let left = COOLDOWN;
  yesBtn.disabled = true;
  yesBtn.textContent = "Yes (" + left + ")";
  overlay.classList.remove("hidden");

  clearInterval(timer);
  timer = setInterval(function () {
    left--;
    if (left <= 0) {
      clearInterval(timer);
      yesBtn.disabled = false;
      yesBtn.textContent = "Yes, remove";
    } else {
      yesBtn.textContent = "Yes (" + left + ")";
    }
  }, 1000);

  document.getElementById("no").focus();
}

yesBtn.addEventListener("click", function () {
  if (onYes && !yesBtn.disabled) {
    onYes();
    closeConfirm();
  }
});

document.getElementById("no").addEventListener("click", closeConfirm);

overlay.addEventListener("click", function (e) {
  if (e.target === overlay) closeConfirm();
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") closeConfirm();
});

// ---------- Log out ----------
document.getElementById("logoutBtn").addEventListener("click", function () {
  try { localStorage.removeItem("demoCurrentUser"); } catch (e) {}
  window.location.href = "login.html";
});

// ---------- Start ----------
document.getElementById("search").addEventListener("input", render);
render();