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

const LEARN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function learnIsUuid(s) { return typeof s === 'string' && LEARN_UUID_RE.test(s); }

/* Validates the shape required by the course engine. Returns { ok: true }
 * or { ok: false, error: string }. */
function learnValidateCourseData(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Plik nie zawiera poprawnego obiektu JSON.' };
  const c = data.course;
  if (!c || typeof c !== 'object') return { ok: false, error: 'Brakuje pola "course".' };
  if (!learnIsUuid(c.id)) return { ok: false, error: 'Pole "course.id" musi być identyfikatorem UUID.' };
  for (const field of ['slug', 'title', 'shortTitle', 'description', 'icon', 'accent']) {
    if (!c[field] || typeof c[field] !== 'string') return { ok: false, error: `Pole "course.${field}" jest wymagane i musi być tekstem.` };
  }
  if (!Array.isArray(data.modules) || data.modules.length === 0) {
    return { ok: false, error: 'Pole "modules" musi być niepustą tablicą.' };
  }

  // First pass: collect every quiz item's id, since exam items reference quizzes
  // that may live in other modules.
  const quizIds = new Set();
  for (const m of data.modules) {
    if (!Array.isArray(m.items)) continue;
    for (const it of m.items) {
      if (it.type === 'quiz' && learnIsUuid(it.id)) quizIds.add(it.id);
    }
  }

  const moduleSlugs = new Set();
  for (const m of data.modules) {
    if (!learnIsUuid(m.id)) return { ok: false, error: `Pole "id" modułu "${m.slug || m.title || '?'}" musi być identyfikatorem UUID.` };
    for (const field of ['slug', 'title', 'shortTitle', 'description', 'icon', 'accent']) {
      if (!m[field] || typeof m[field] !== 'string') return { ok: false, error: `Moduł "${m.slug || m.title || m.id}" wymaga pola "${field}" (tekst).` };
    }
    if (moduleSlugs.has(m.slug)) return { ok: false, error: `Zduplikowany slug modułu: "${m.slug}".` };
    moduleSlugs.add(m.slug);
    if (!Array.isArray(m.items) || m.items.length === 0) return { ok: false, error: `Moduł "${m.slug}" musi mieć niepustą listę "items".` };
    const itemSlugs = new Set(); // unique per module across article/quiz/exam
    for (const it of m.items) {
      if (it.type !== 'article' && it.type !== 'quiz' && it.type !== 'exam') return { ok: false, error: `Nieprawidłowy typ elementu "${it.type}" w module "${m.slug}" (dozwolone: article, quiz, exam).` };
      if (!learnIsUuid(it.id)) return { ok: false, error: `Pole "id" elementu "${it.slug || it.title || '?'}" w module "${m.slug}" musi być identyfikatorem UUID.` };
      for (const field of ['slug', 'title', 'shortTitle', 'description']) {
        if (!it[field] || typeof it[field] !== 'string') return { ok: false, error: `Element "${it.slug || it.id}" w module "${m.slug}" wymaga pola "${field}" (tekst).` };
      }
      if (itemSlugs.has(it.slug)) return { ok: false, error: `Zduplikowany slug elementu "${it.slug}" w module "${m.slug}" (slug musi być unikalny w obrębie modułu, niezależnie od typu).` };
      itemSlugs.add(it.slug);
      if (it.type === 'article' && typeof it.content !== 'string') return { ok: false, error: `Artykuł "${it.slug}" wymaga pola "content" (tekst markdown).` };
      if (it.type === 'quiz') {
        if (!('passThreshold' in it) || (it.passThreshold !== null && typeof it.passThreshold !== 'number')) {
          return { ok: false, error: `Quiz "${it.slug}" wymaga pola "passThreshold" (liczba lub null).` };
        }
        if (!Array.isArray(it.questions) || it.questions.length === 0) return { ok: false, error: `Quiz "${it.slug}" musi mieć niepustą listę "questions".` };
        for (const q of it.questions) {
          if (!learnIsUuid(q.id)) return { ok: false, error: `Pole "id" pytania w quizie "${it.slug}" musi być identyfikatorem UUID.` };
          if (!q.question || !Array.isArray(q.options) || !Array.isArray(q.answer) || q.answer.length === 0) {
            return { ok: false, error: `Nieprawidłowe pytanie w quizie "${it.slug}" — wymagane: "question", "options"[], "answer"[].` };
          }
        }
      }
      if (it.type === 'exam') {
        if (!('passThreshold' in it) || (it.passThreshold !== null && typeof it.passThreshold !== 'number')) {
          return { ok: false, error: `Element egzaminacyjny "${it.slug}" wymaga pola "passThreshold" (liczba lub null).` };
        }
        if (!Array.isArray(it.quizes) || it.quizes.length === 0) return { ok: false, error: `Element egzaminacyjny "${it.slug}" musi mieć niepustą listę "quizes".` };
        for (const ref of it.quizes) {
          if (!learnIsUuid(ref.id) || !quizIds.has(ref.id)) return { ok: false, error: `Element "quizes" w "${it.slug}" zawiera nieprawidłowe lub nieistniejące "id" quizu: "${ref.id}".` };
          if (typeof ref.weight !== 'number') return { ok: false, error: `Każdy wpis w "quizes" elementu "${it.slug}" wymaga liczbowego pola "weight".` };
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
