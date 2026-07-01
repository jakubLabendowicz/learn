/* Imported courses: full course.json content stored client-side, keyed by course slug. */
const LEARN_IMPORTED_KEY = 'learn:imported-courses:v1';

function learnLoadImportedCourses() {
  try {
    const raw = localStorage.getItem(LEARN_IMPORTED_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

function learnSaveImportedCourses(all) {
  localStorage.setItem(LEARN_IMPORTED_KEY, JSON.stringify(all));
}

function learnGetImportedCourse(slug) {
  const all = learnLoadImportedCourses();
  return all[slug] || null;
}

/* Downloads the course's JSON as a file, whether it's imported (read from
 * localStorage) or built-in (fetched from the server). */
async function learnExportCourse(slug) {
  let data = learnGetImportedCourse(slug);
  if (!data) {
    const r = await fetch(`/courses/${slug}.json`);
    if (!r.ok) { alert('Nie udało się pobrać danych kursu do eksportu.'); return; }
    data = await r.json();
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function learnListImportedCourses() {
  const all = learnLoadImportedCourses();
  return Object.values(all).map(data => ({
    id: data.course.id,
    slug: data.course.slug,
    title: data.course.title,
    shortTitle: data.course.shortTitle,
    description: data.course.description,
    icon: data.course.icon,
    accent: data.course.accent,
    moduleCount: data.modules.length,
  }));
}

function learnDeleteImportedCourse(slug) {
  const all = learnLoadImportedCourses();
  delete all[slug];
  learnSaveImportedCourses(all);
}

/* Validates the shape required by the course engine. Returns { ok: true }
 * or { ok: false, error: string }. */
function learnValidateCourseData(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Plik nie zawiera poprawnego obiektu JSON.' };
  const c = data.course;
  if (!c || typeof c !== 'object') return { ok: false, error: 'Brakuje pola "course".' };
  for (const field of ['id', 'slug', 'title']) {
    if (!c[field] || typeof c[field] !== 'string') return { ok: false, error: `Pole "course.${field}" jest wymagane i musi być tekstem.` };
  }
  if (!Array.isArray(data.modules) || data.modules.length === 0) {
    return { ok: false, error: 'Pole "modules" musi być niepustą tablicą.' };
  }
  const moduleSlugs = new Set();
  for (const m of data.modules) {
    if (!m.id || !m.slug || !m.title) return { ok: false, error: `Każdy moduł wymaga pól "id", "slug", "title" (błąd w module: ${JSON.stringify(m.id || m.title || '?')}).` };
    if (moduleSlugs.has(m.slug)) return { ok: false, error: `Zduplikowany slug modułu: "${m.slug}".` };
    moduleSlugs.add(m.slug);
    if (!Array.isArray(m.items) || m.items.length === 0) return { ok: false, error: `Moduł "${m.slug}" musi mieć niepustą listę "items".` };
    const itemSlugs = { article: new Set(), quiz: new Set() };
    for (const it of m.items) {
      if (it.type !== 'article' && it.type !== 'quiz') return { ok: false, error: `Nieprawidłowy typ elementu "${it.type}" w module "${m.slug}" (dozwolone: article, quiz).` };
      if (!it.id || !it.slug || !it.title) return { ok: false, error: `Element w module "${m.slug}" wymaga pól "id", "slug", "title".` };
      if (itemSlugs[it.type].has(it.slug)) return { ok: false, error: `Zduplikowany slug ${it.type} "${it.slug}" w module "${m.slug}".` };
      itemSlugs[it.type].add(it.slug);
      if (it.type === 'article' && typeof it.content !== 'string') return { ok: false, error: `Artykuł "${it.slug}" wymaga pola "content" (tekst markdown).` };
      if (it.type === 'quiz') {
        if (!Array.isArray(it.questions) || it.questions.length === 0) return { ok: false, error: `Quiz "${it.slug}" musi mieć niepustą listę "questions".` };
        for (const q of it.questions) {
          if (!q.question || !Array.isArray(q.options) || !Array.isArray(q.answer) || q.answer.length === 0) {
            return { ok: false, error: `Nieprawidłowe pytanie w quizie "${it.slug}" — wymagane: "question", "options"[], "answer"[].` };
          }
        }
      }
    }
  }
  return { ok: true };
}

/* Validates and stores the course. Returns { ok: true, slug } or { ok: false, error }. */
function learnImportCourse(data) {
  const result = learnValidateCourseData(data);
  if (!result.ok) return result;
  const all = learnLoadImportedCourses();
  all[data.course.slug] = data;
  learnSaveImportedCourses(all);
  return { ok: true, slug: data.course.slug };
}
