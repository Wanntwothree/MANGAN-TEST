const roleDashboard = (role) => role === "admin" ? "/admin.html" : role === "owner" ? "/owner.html" : "/";

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const isVisible = input.type === "text";
    input.type = isVisible ? "password" : "text";
    button.textContent = isVisible ? "Show" : "Hide";
    button.setAttribute("aria-pressed", String(!isVisible));
    button.setAttribute("aria-label", `${isVisible ? "Show" : "Hide"} ${input.labels[0]?.textContent || "password"}`);
  });
});

const registerPassword = document.querySelector("#register-password");
const passwordRequirements = document.querySelector("#password-requirements");
const passwordRuleChecks = {
  length: (value) => value.length >= 8 && value.length <= 128,
  uppercase: (value) => /[A-Z]/.test(value),
  lowercase: (value) => /[a-z]/.test(value),
  number: (value) => /[0-9]/.test(value),
  symbol: (value) => /[^A-Za-z0-9\s]/.test(value)
};

function passwordMeetsRequirements(value) {
  return Object.values(passwordRuleChecks).every((check) => check(value));
}

if (registerPassword && passwordRequirements) {
  registerPassword.addEventListener("input", () => {
    const value = registerPassword.value;
    for (const [rule, check] of Object.entries(passwordRuleChecks)) {
      const item = passwordRequirements.querySelector(`[data-password-rule="${rule}"]`);
      const passed = check(value);
      item.classList.toggle("is-valid", passed);
      item.classList.toggle("is-invalid", value.length > 0 && !passed);
      item.querySelector("span").textContent = passed ? "✓" : value.length > 0 ? "×" : "○";
    }
  });
}

function setAuthMessage(message, success = false) {
  const target = document.querySelector("#auth-message");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("is-success", success);
}

async function sendAuthRequest(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("Could not reach the beta server. Please try again.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Your request could not be completed.");
  return result;
}

async function showSignedInAccount() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin" });
    const result = await response.json();
    if (result.user && document.body.dataset.authPage !== "reset") {
      window.location.replace(roleDashboard(result.user.role));
    }
  } catch {
    setAuthMessage("The beta server is not responding. Check that it is running.");
  }
}

const loginForm = document.querySelector("#login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = loginForm.querySelector("[type=submit]");
    submit.disabled = true;
    setAuthMessage("");
    try {
      const data = Object.fromEntries(new FormData(loginForm));
      const result = await sendAuthRequest("/api/auth/login", data);
      const desired = new URLSearchParams(window.location.search).get("next");
      const allowedNext = ["/", "/owner.html", "/admin.html"].includes(desired) ? desired : "";
      window.location.replace(allowedNext || roleDashboard(result.user.role));
    } catch (error) {
      setAuthMessage(error.message);
      submit.disabled = false;
    }
  });
}

const registerForm = document.querySelector("#register-form");
if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = registerForm.querySelector("[type=submit]");
    const values = Object.fromEntries(new FormData(registerForm));
    if (!passwordMeetsRequirements(values.password)) {
      setAuthMessage("Your password must meet every requirement shown above.");
      return;
    }
    if (values.password !== values.confirmPassword) {
      setAuthMessage("Your passwords don’t match.");
      return;
    }
    submit.disabled = true;
    setAuthMessage("");
    try {
      delete values.confirmPassword;
      const result = await sendAuthRequest("/api/auth/register", values);
      window.location.replace(roleDashboard(result.user.role));
    } catch (error) {
      setAuthMessage(error.message);
      submit.disabled = false;
    }
  });
}

const forgotForm = document.querySelector("#forgot-form");
if (forgotForm) {
  forgotForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = forgotForm.querySelector("[type=submit]");
    const email = new FormData(forgotForm).get("email");
    submit.disabled = true;
    setAuthMessage("");
    document.querySelector("#reset-code-callout").hidden = true;
    try {
      const result = await sendAuthRequest("/api/auth/forgot", { email });
      setAuthMessage(result.message, true);
      if (result.developmentCode) {
        const callout = document.querySelector("#reset-code-callout");
        callout.hidden = false;
        callout.querySelector("strong").textContent = result.developmentCode;
        sessionStorage.setItem("mangan-reset-email", String(email));
        sessionStorage.setItem("mangan-reset-code", result.developmentCode);
      }
    } catch (error) {
      setAuthMessage(error.message);
    } finally {
      submit.disabled = false;
    }
  });
}

const resetForm = document.querySelector("#reset-form");
if (resetForm) {
  const emailInput = resetForm.querySelector('[name="email"]');
  const codeInput = resetForm.querySelector('[name="code"]');
  emailInput.value = new URLSearchParams(window.location.search).get("email") || sessionStorage.getItem("mangan-reset-email") || "";
  codeInput.value = sessionStorage.getItem("mangan-reset-code") || "";
  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = resetForm.querySelector("[type=submit]");
    const values = Object.fromEntries(new FormData(resetForm));
    if (values.password !== values.confirmPassword) {
      setAuthMessage("Your passwords don’t match.");
      return;
    }
    delete values.confirmPassword;
    submit.disabled = true;
    setAuthMessage("");
    try {
      await sendAuthRequest("/api/auth/reset", values);
      sessionStorage.removeItem("mangan-reset-email");
      sessionStorage.removeItem("mangan-reset-code");
      setAuthMessage("Password updated. Sending you to sign in…", true);
      setTimeout(() => window.location.replace("/login.html"), 900);
    } catch (error) {
      setAuthMessage(error.message);
      submit.disabled = false;
    }
  });
}

if (!["reset"].includes(document.body.dataset.authPage)) showSignedInAccount();
