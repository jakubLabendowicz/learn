# learn

This repository has been split into two separate projects, one per
Cloudflare Workers deployment:

- **[learn-marketing](https://github.com/jakubLabendowicz/learn-marketing)**
  — the public marketing/landing page (previously `src/pages/marketing`,
  `MarketingLayout`, and the `marketing.css`/shared `style.css` assets).
- **[learn-app](https://github.com/jakubLabendowicz/learn-app)** — the
  course app itself: dashboard, courses, quizzes, profile, the
  local-storage data layer, and the bundled course content
  (previously everything under `AppLayout`, `src/pages/courses`,
  `src/pages/profile.astro`, and `public/courses` / `public/archive`).

All history up to the split is still available on this repo's `main`
branch. New work should happen in the two repos above.
