// Language switch: keep the section you were reading when changing language.
(() => {
  document.querySelectorAll(".lang a:not([aria-current])").forEach((a) => {
    a.addEventListener("click", (e) => {
      if (!location.hash) return;
      e.preventDefault();
      location.assign(a.href.split("#")[0] + location.hash);
    });
  });
})();

// Show the compact top bar only once the board has scrolled out of view,
// so the name appears once on screen at any time.
(() => {
  const bar = document.querySelector(".bar");
  const stage = document.querySelector(".hero__stage");
  if (!bar || !stage || !("IntersectionObserver" in window)) return;

  new IntersectionObserver(
    ([entry]) => {
      const show = !entry.isIntersecting;
      bar.classList.toggle("is-shown", show);
      bar.inert = !show;
    },
    { rootMargin: "-56px 0px 0px 0px" }
  ).observe(stage);
})();
