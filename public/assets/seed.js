/* App bootstrap: seeds the built-in courses (listed in
 * /courses/manifest.json) and the default user into the local DB the
 * first time the app ever runs. A no-op on every later call (including
 * after the user deletes a built-in course — it stays deleted). Not tied
 * to a single entity, so it lives outside /assets/data as a small
 * orchestration on top of the userRepository/courseRepository. */
async function learnEnsureSeeded() {
  userRepository.ensureDefault();
  if (learnIsSeeded()) return;
  try {
    const slugs = await fetch('/courses/manifest.json').then(r => r.json());
    for (const slug of slugs) {
      const data = await fetch(`/courses/${slug}.json`).then(r => r.json());
      courseRepository.importCourse(data);
    }
  } catch (e) {}
  learnMarkSeeded();
}
