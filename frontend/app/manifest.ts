import type { MetadataRoute } from "next";

// "Add to Home Screen" opens the site as an app with no browser bars — the
// only way to get a full-screen exam on iPhone (and a cleaner one on Android).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Registon O'quv Markazi",
    short_name: "Registon",
    description: "Registon o'quv markazi o'quvchilari uchun ingliz tili imtihonlari.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0f1218",
    theme_color: "#0f1218",
    icons: [{ src: "/icon.png", sizes: "2048x2048", type: "image/png", purpose: "any" }],
  };
}
