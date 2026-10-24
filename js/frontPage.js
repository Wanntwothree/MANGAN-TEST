document.querySelectorAll(".carousel").forEach(carousel => {
  const slides = carousel.querySelectorAll(".slide");
  const dotsBox = carousel.querySelector(".dots");
  const nextBtn = carousel.querySelector(".next");
  const prevBtn = carousel.querySelector(".prev");

  let current = 0;
  let timer;

  slides.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.setAttribute("aria-label", "Go to slide " + (i + 1));
    dot.addEventListener("click", () => { show(i); restart(); });
    dotsBox.appendChild(dot);
  });
  const dots = dotsBox.querySelectorAll("button");

  function show(i) {
    slides[current].classList.remove("active");
    dots[current].classList.remove("active");
    current = (i + slides.length) % slides.length;
    slides[current].classList.add("active");
    dots[current].classList.add("active");
  }

  function restart() {
    clearInterval(timer);
    timer = setInterval(() => show(current + 1), 3000);
  }

  nextBtn.addEventListener("click", () => { show(current + 1); restart(); });
  prevBtn.addEventListener("click", () => { show(current - 1); restart(); });

  dots[0].classList.add("active");
  restart();
});

document.getElementById("viewMoreBtn").addEventListener("click", function (e) {
  e.preventDefault();
  const user = localStorage.getItem("demoCurrentUser");
  window.location.href = user ? "moodSelect.html" : "login.html";
});

(function () {
  const email = localStorage.getItem("demoCurrentUser");
  if (!email) return;

  let name = email;
  try { name = JSON.parse(localStorage.getItem("demoUsers"))[email].name || email; } catch (e) {}

  const nav = document.querySelector(".nav-links");
  nav.innerHTML = "";

  const li1 = document.createElement("li");
  const hello = document.createElement("span");
  hello.className = "nav-user";
  hello.textContent = "Hi, " + name;
  li1.appendChild(hello);

  const li2 = document.createElement("li");
  const out = document.createElement("a");
  out.href = "#";
  out.className = "btn-register active";
  out.textContent = "Log out";
  out.addEventListener("click", function (e) {
    e.preventDefault();
    localStorage.removeItem("demoCurrentUser");
    window.location.href = "frontPage.html";
  });
  li2.appendChild(out);

  nav.append(li1, li2);
})();