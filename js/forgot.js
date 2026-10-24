const fEmail = document.getElementById("fEmail");
const sendBtn = document.querySelector("#forgotForm button[type='submit']");

sendBtn.disabled = true;
fEmail.addEventListener("input", function () {
  sendBtn.disabled = !fEmail.checkValidity() || fEmail.value.trim() === "";
});

document.getElementById("forgotForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  const email = fEmail.value.trim().toLowerCase();
  const user = getUsers()[email];
  if (!user || email === ADMIN_EMAIL) return setMsg("No account found with that email.");

  sendBtn.disabled = true;
  setMsg("Sending code...", true);
  try {
    const sent = await Verify.send(email, user.name);
    Verify.save(Object.assign({ purpose: "reset", name: user.name, email: email }, sent));
    window.location.href = "verify.html";
  } catch (err) {
    console.error(err);
    setMsg("Could not send the email. Try again.");
    sendBtn.disabled = false;
  }
});