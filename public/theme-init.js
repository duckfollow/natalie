(() => {
  let preference;
  try {
    preference = localStorage.getItem("natalie.appearance");
  } catch {
    // Use the operating system appearance when storage is unavailable.
  }
  document.documentElement.dataset.theme =
    preference === "light" || preference === "dark"
      ? preference
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
})();
