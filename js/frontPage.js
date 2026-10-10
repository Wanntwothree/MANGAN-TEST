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