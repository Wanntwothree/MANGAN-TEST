function checkLogin() {
  if (!localStorage.getItem("demoCurrentUser")) {
    window.location.replace("login.html");
  }
}

checkLogin();
window.addEventListener("pageshow", function (e) {
  if (e.persisted) checkLogin();
});