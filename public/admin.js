const adminMessage = document.querySelector("#admin-message");

async function adminApi(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(options.body && { "Content-Type": "application/json" }) },
      ...options
    });
  } catch {
    throw new Error("Could not reach MANGAN. Check that the beta server is running.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "That request could not be completed.");
  return result;
}

function adminEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function adminFeedback(message, error = false) {
  adminMessage.textContent = message;
  adminMessage.classList.toggle("is-error", error);
}

function renderAdminData(data) {
  document.querySelector("#stat-users").textContent = data.stats.users;
  document.querySelector("#stat-owners").textContent = data.stats.owners;
  document.querySelector("#stat-restaurants").textContent = data.stats.restaurants;
  document.querySelector("#stat-pending").textContent = data.stats.pending;

  document.querySelector("#admin-restaurants").innerHTML = data.restaurants.length ? `
    <table class="data-table"><thead><tr><th>Restaurant</th><th>Owner</th><th>Area</th><th>Estimated price / person</th><th>Status</th><th>Review</th></tr></thead>
    <tbody>${data.restaurants.map((restaurant) => `
      <tr>
        <td>${adminEscape(restaurant.name)}</td>
        <td>${adminEscape(restaurant.ownerName || "MANGAN sample")}<br><span class="neighborhood">${adminEscape(restaurant.ownerEmail || "")}</span></td>
        <td>${adminEscape(restaurant.neighborhood)}</td>
        <td>₱${Number(restaurant.priceMin).toLocaleString("en-PH")}–₱${Number(restaurant.priceMax).toLocaleString("en-PH")}</td>
        <td><span class="status-pill ${adminEscape(restaurant.status)}">${adminEscape(restaurant.status)}</span></td>
        <td><div class="table-actions">
          ${restaurant.status !== "approved" ? `<button class="table-action" type="button" data-review-id="${restaurant.id}" data-review-status="approved">Approve</button>` : ""}
          ${restaurant.status !== "rejected" ? `<button class="table-action danger" type="button" data-review-id="${restaurant.id}" data-review-status="rejected">Reject</button>` : ""}
        </div></td>
      </tr>`).join("")}</tbody></table>` : '<p class="dashboard-empty">No restaurant listings yet.</p>';

  document.querySelector("#admin-users").innerHTML = data.users.length ? `
    <table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Account status</th><th>Action</th></tr></thead>
    <tbody>${data.users.map((user) => `
      <tr>
        <td>${adminEscape(user.name)}</td><td>${adminEscape(user.email)}</td><td>${adminEscape(user.role)}</td>
        <td>${new Date(user.createdAt).toLocaleDateString("en-PH")}</td>
        <td><span class="status-pill ${user.isActive ? "active" : "inactive"}">${user.isActive ? "Active" : "Disabled"}</span></td>
        <td>${user.role === "admin" ? "Protected" : `<button class="table-action ${user.isActive ? "danger" : ""}" type="button" data-user-id="${user.id}" data-user-active="${!user.isActive}">${user.isActive ? "Suspend" : "Restore"}</button>`}</td>
      </tr>`).join("")}</tbody></table>` : '<p class="dashboard-empty">No accounts yet.</p>';

  document.querySelector("#feedback-count").textContent = `${data.stats.feedback} feedback notes received`;
  document.querySelector("#admin-feedback").innerHTML = data.feedback.length ? data.feedback.map((item) => `
    <article class="feedback-item"><header><strong>${adminEscape(item.topic)}</strong><time>${new Date(item.createdAt).toLocaleString("en-PH")}</time></header><p>${adminEscape(item.message)}</p></article>
  `).join("") : '<p class="dashboard-empty feedback-empty">No beta feedback has arrived yet.</p>';
}

async function loadAdminData() {
  const data = await adminApi("/api/admin/overview");
  renderAdminData(data);
}

document.querySelector("#admin-restaurants").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-review-id]");
  if (!button) return;
  const status = button.dataset.reviewStatus;
  if (status === "rejected" && !window.confirm("Reject this restaurant listing?")) return;
  button.disabled = true;
  try {
    await adminApi(`/api/admin/restaurants/${button.dataset.reviewId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    adminFeedback(`Restaurant ${status}.`);
    await loadAdminData();
  } catch (error) {
    adminFeedback(error.message, true);
    button.disabled = false;
  }
});

document.querySelector("#admin-users").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-user-id]");
  if (!button) return;
  const isActive = button.dataset.userActive === "true";
  if (!isActive && !window.confirm("Suspend this account? They will not be able to sign in.")) return;
  button.disabled = true;
  try {
    await adminApi(`/api/admin/users/${button.dataset.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive })
    });
    adminFeedback(isActive ? "Account restored." : "Account suspended.");
    await loadAdminData();
  } catch (error) {
    adminFeedback(error.message, true);
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await adminApi("/api/auth/logout", { method: "POST" });
  window.location.replace("/login.html");
});

(async () => {
  try {
    const { user } = await adminApi("/api/auth/me");
    if (!user) {
      window.location.replace("/login.html?next=%2Fadmin.html");
      return;
    }
    if (user.role !== "admin") {
      window.location.replace("/");
      return;
    }
    await loadAdminData();
  } catch (error) {
    adminFeedback(error.message, true);
  }
})();
