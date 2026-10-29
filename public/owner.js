const form = document.querySelector("#restaurant-form");
const ownerList = document.querySelector("#owner-list");
const ownerMessage = document.querySelector("#owner-message");
let ownedRestaurants = [];

async function ownerApi(url, options = {}) {
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

function ownerEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function ownerFeedback(message, error = false) {
  ownerMessage.textContent = message;
  ownerMessage.classList.toggle("is-error", error);
}

async function loadOwnedRestaurants() {
  const data = await ownerApi("/api/owner/restaurants");
  ownedRestaurants = data.restaurants;
  const countStatus = (status) => ownedRestaurants.filter((restaurant) => restaurant.status === status).length;
  document.querySelector("#stat-total").textContent = ownedRestaurants.length;
  document.querySelector("#stat-approved").textContent = countStatus("approved");
  document.querySelector("#stat-pending").textContent = countStatus("pending");
  document.querySelector("#stat-rejected").textContent = countStatus("rejected");
  ownerList.innerHTML = ownedRestaurants.length ? `
    <table class="data-table"><thead><tr><th>Restaurant</th><th>Area</th><th>Est. price / person</th><th>Review status</th><th>Actions</th></tr></thead>
    <tbody>${ownedRestaurants.map((restaurant) => `
      <tr>
        <td>${ownerEscape(restaurant.name)}</td>
        <td>${ownerEscape(restaurant.neighborhood)}</td>
        <td>₱${Number(restaurant.priceMin).toLocaleString("en-PH")}–₱${Number(restaurant.priceMax).toLocaleString("en-PH")}</td>
        <td><span class="status-pill ${ownerEscape(restaurant.status)}">${ownerEscape(restaurant.status)}</span></td>
        <td><div class="table-actions"><button class="table-action secondary" type="button" data-edit-id="${restaurant.id}">Edit</button><button class="table-action danger" type="button" data-delete-id="${restaurant.id}">Delete</button></div></td>
      </tr>`).join("")}</tbody></table>` : '<p class="dashboard-empty">No listings yet. Add your first restaurant above.</p>';
}

function clearOwnerForm() {
  form.reset();
  form.elements.restaurantId.value = "";
  document.querySelector("#owner-form-title").textContent = "Add your restaurant";
  document.querySelector("#restaurant-submit").textContent = "Submit for review ↗";
  document.querySelector("#restaurant-cancel").hidden = true;
}

function editOwnedRestaurant(id) {
  const restaurant = ownedRestaurants.find((item) => item.id === id);
  if (!restaurant) return;
  form.elements.restaurantId.value = restaurant.id;
  form.elements.name.value = restaurant.name;
  form.elements.neighborhood.value = restaurant.neighborhood;
  form.elements.address.value = restaurant.address;
  form.elements.latitude.value = restaurant.latitude ?? "";
  form.elements.longitude.value = restaurant.longitude ?? "";
  form.elements.description.value = restaurant.description;
  form.elements.priceMin.value = restaurant.priceMin;
  form.elements.priceMax.value = restaurant.priceMax;
  form.elements.hours.value = restaurant.hours;
  form.elements.imageUrl.value = restaurant.imageUrl;
  form.elements.venueImageUrl.value = restaurant.venueImageUrl || restaurant.imageUrl;
  form.elements.highlights.value = restaurant.highlights.join(", ");
  form.querySelectorAll('input[name="categories"]').forEach((input) => {
    input.checked = restaurant.categories.includes(input.value);
  });
  document.querySelector("#owner-form-title").textContent = "Edit your restaurant";
  document.querySelector("#restaurant-submit").textContent = "Resubmit for review ↗";
  document.querySelector("#restaurant-cancel").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function restaurantFormData() {
  const values = Object.fromEntries(new FormData(form));
  values.categories = [...form.querySelectorAll('input[name="categories"]:checked')].map((input) => input.value);
  values.highlights = values.highlights.split(",").map((highlight) => highlight.trim()).filter(Boolean).slice(0, 5);
  values.priceMin = Number(values.priceMin);
  values.priceMax = Number(values.priceMax);
  values.latitude = values.latitude === "" ? null : Number(values.latitude);
  values.longitude = values.longitude === "" ? null : Number(values.longitude);
  delete values.restaurantId;
  return values;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#restaurant-submit");
  const id = form.elements.restaurantId.value;
  submit.disabled = true;
  ownerFeedback("");
  try {
    await ownerApi(id ? `/api/owner/restaurants/${id}` : "/api/owner/restaurants", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(restaurantFormData())
    });
    clearOwnerForm();
    ownerFeedback(id
      ? "Updates saved. Your listing is back in the review queue."
      : "Listing submitted. It will appear publicly after admin approval.");
    await loadOwnedRestaurants();
  } catch (error) {
    ownerFeedback(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

ownerList.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-id]");
  const deleteButton = event.target.closest("[data-delete-id]");
  if (editButton) editOwnedRestaurant(Number(editButton.dataset.editId));
  if (deleteButton) {
    const id = Number(deleteButton.dataset.deleteId);
    if (!window.confirm("Delete this restaurant listing? This cannot be undone.")) return;
    try {
      await ownerApi(`/api/owner/restaurants/${id}`, { method: "DELETE" });
      ownerFeedback("Listing deleted.");
      await loadOwnedRestaurants();
    } catch (error) {
      ownerFeedback(error.message, true);
    }
  }
});

document.querySelector("#restaurant-cancel").addEventListener("click", clearOwnerForm);
document.querySelector("#geocode-address").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  ownerFeedback("");
  try {
    const { location } = await ownerApi("/api/owner/geocode", {
      method: "POST",
      body: JSON.stringify({ address: form.elements.address.value })
    });
    form.elements.latitude.value = location.latitude;
    form.elements.longitude.value = location.longitude;
    ownerFeedback(`Coordinates found: ${location.formattedAddress}. Review the pin before submitting.`);
  } catch (error) {
    ownerFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await ownerApi("/api/auth/logout", { method: "POST" });
  window.location.replace("/login.html");
});

(async () => {
  try {
    const { user } = await ownerApi("/api/auth/me");
    if (!user) {
      window.location.replace("/login.html?next=%2Fowner.html");
      return;
    }
    if (user.role !== "owner" && user.role !== "admin") {
      window.location.replace("/");
      return;
    }
    await loadOwnedRestaurants();
  } catch (error) {
    ownerFeedback(error.message, true);
  }
})();
