/* Local "database": courses, modules and items stored as three normalized
 * tables (with UUID ids and id-reference relations between them) in a
 * single localStorage key. This is the app's only source of course data —
 * built-in courses are seeded here on first load (see learnEnsureSeeded)
 * from their course.json files, and every page reads exclusively from here
 * afterwards, whether the course is built-in or user-imported. */
const LEARN_DB_KEY = 'learn:db:v1';
const LEARN_SEEDED_KEY = 'learn:seeded-builtin:v1';

function learnLoadDB() {
  try {
    const raw = localStorage.getItem(LEARN_DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.courses) && Array.isArray(parsed.modules) && Array.isArray(parsed.items)) return parsed;
    }
  } catch (e) {}
  return { courses: [], modules: [], items: [] };
}

function learnSaveDB(db) {
  localStorage.setItem(LEARN_DB_KEY, JSON.stringify(db));
}

/* Seeds the built-in courses (listed in /courses/manifest.json) into the
 * local DB the first time the app ever runs. A no-op on every later call
 * (including after the user deletes a built-in course — it stays deleted). */
async function learnEnsureSeeded() {
  if (localStorage.getItem(LEARN_SEEDED_KEY)) return;
  try {
    const slugs = await fetch('/courses/manifest.json').then(r => r.json());
    for (const slug of slugs) {
      const data = await fetch(`/courses/${slug}.json`).then(r => r.json());
      learnImportCourse(data);
    }
  } catch (e) {}
  localStorage.setItem(LEARN_SEEDED_KEY, '1');
}

/* Resolves a course by slug into { course, modules }, where each module
 * has its "items" refs resolved into full item objects (in course/module
 * order) — the shape the course engine renders directly. */
function learnGetCourseData(slug) {
  const db = learnLoadDB();
  const course = db.courses.find(c => c.slug === slug);
  if (!course) return null;
  const modules = course.modules
    .map(ref => db.modules.find(m => m.id === ref.module_id))
    .filter(Boolean)
    .map(m => Object.assign({}, m, {
      items: m.items.map(ref => db.items.find(it => it.id === ref.item_id)).filter(Boolean),
    }));
  return { course, modules };
}

/* Lightweight summaries for listing pages (course grid, import page). */
function learnListCourses() {
  const db = learnLoadDB();
  return db.courses.map(c => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    shortTitle: c.shortTitle,
    description: c.description,
    shortDescription: c.shortDescription,
    icon: c.icon,
    accent: c.accent,
    moduleCount: c.modules.length,
  }));
}

/* Removes a course's own row plus every module/item it (exclusively) owns. */
function learnRemoveCourseRows(db, courseId) {
  const course = db.courses.find(c => c.id === courseId);
  if (!course) return;
  const moduleIds = new Set(course.modules.map(r => r.module_id));
  const itemIds = new Set();
  db.modules.filter(m => moduleIds.has(m.id)).forEach(m => m.items.forEach(r => itemIds.add(r.item_id)));
  db.courses = db.courses.filter(c => c.id !== courseId);
  db.modules = db.modules.filter(m => !moduleIds.has(m.id));
  db.items = db.items.filter(it => !itemIds.has(it.id));
}

function learnDeleteCourse(slug) {
  const db = learnLoadDB();
  const course = db.courses.find(c => c.slug === slug);
  if (course) learnRemoveCourseRows(db, course.id);
  learnSaveDB(db);
}

/* Downloads the normalized { courses, modules, items } subgraph for one
 * course as a course.json file. */
function learnExportCourse(slug) {
  const db = learnLoadDB();
  const course = db.courses.find(c => c.slug === slug);
  if (!course) { alert('Nie udało się znaleźć kursu do eksportu.'); return; }
  const moduleIds = new Set(course.modules.map(r => r.module_id));
  const modules = db.modules.filter(m => moduleIds.has(m.id));
  const itemIds = new Set();
  modules.forEach(m => m.items.forEach(r => itemIds.add(r.item_id)));
  const items = db.items.filter(it => itemIds.has(it.id));
  const data = { courses: [course], modules, items };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const LEARN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function learnIsUuid(s) { return typeof s === 'string' && LEARN_UUID_RE.test(s); }

/* Validates the normalized { courses, modules, items } shape, including
 * referential integrity between the three tables (course -> module_id,
 * module -> item_id, exam -> quiz item_id). Returns { ok: true } or
 * { ok: false, error: string }. */
function learnValidateCourseData(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Plik nie zawiera poprawnego obiektu JSON.' };
  if (!Array.isArray(data.courses) || data.courses.length === 0) return { ok: false, error: 'Pole "courses" musi być niepustą tablicą.' };
  if (!Array.isArray(data.modules)) return { ok: false, error: 'Pole "modules" musi być tablicą.' };
  if (!Array.isArray(data.items)) return { ok: false, error: 'Pole "items" musi być tablicą.' };

  const moduleById = new Map();
  for (const m of data.modules) {
    if (!learnIsUuid(m.id)) return { ok: false, error: `Pole "id" modułu "${m.slug || m.title || '?'}" musi być identyfikatorem UUID.` };
    if (moduleById.has(m.id)) return { ok: false, error: `Zduplikowany "id" modułu: "${m.id}".` };
    for (const field of ['slug', 'title', 'shortTitle', 'description', 'shortDescription', 'icon', 'accent']) {
      if (!m[field] || typeof m[field] !== 'string') return { ok: false, error: `Moduł "${m.slug || m.title || m.id}" wymaga pola "${field}" (tekst).` };
    }
    if (!Array.isArray(m.items) || m.items.length === 0) return { ok: false, error: `Moduł "${m.slug}" musi mieć niepustą listę "items" (referencje "item_id").` };
    moduleById.set(m.id, m);
  }

  const itemById = new Map();
  const quizIds = new Set();
  for (const it of data.items) {
    if (!learnIsUuid(it.id)) return { ok: false, error: `Pole "id" elementu "${it.slug || it.title || '?'}" musi być identyfikatorem UUID.` };
    if (itemById.has(it.id)) return { ok: false, error: `Zduplikowany "id" elementu: "${it.id}".` };
    if (it.type !== 'article' && it.type !== 'quiz' && it.type !== 'exam') return { ok: false, error: `Nieprawidłowy typ elementu "${it.type}" (dozwolone: article, quiz, exam) w "${it.slug || it.id}".` };
    for (const field of ['slug', 'title', 'shortTitle', 'description', 'shortDescription']) {
      if (!it[field] || typeof it[field] !== 'string') return { ok: false, error: `Element "${it.slug || it.id}" wymaga pola "${field}" (tekst).` };
    }
    itemById.set(it.id, it);
    if (it.type === 'quiz') quizIds.add(it.id);
  }

  for (const it of data.items) {
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
        if (!learnIsUuid(ref.item_id) || !quizIds.has(ref.item_id)) return { ok: false, error: `Element "quizes" w "${it.slug}" zawiera nieprawidłowe lub nieistniejące "item_id" quizu: "${ref.item_id}".` };
        if (typeof ref.weight !== 'number') return { ok: false, error: `Każdy wpis w "quizes" elementu "${it.slug}" wymaga liczbowego pola "weight".` };
      }
    }
  }

  for (const m of data.modules) {
    const itemSlugs = new Set(); // unique per module across article/quiz/exam
    for (const ref of m.items) {
      if (!learnIsUuid(ref.item_id) || !itemById.has(ref.item_id)) return { ok: false, error: `Moduł "${m.slug}" odwołuje się do nieistniejącego elementu "item_id": "${ref.item_id}".` };
      const it = itemById.get(ref.item_id);
      if (itemSlugs.has(it.slug)) return { ok: false, error: `Zduplikowany slug elementu "${it.slug}" w module "${m.slug}" (slug musi być unikalny w obrębie modułu, niezależnie od typu).` };
      itemSlugs.add(it.slug);
    }
  }

  const moduleSlugsPerCourse = new Set();
  for (const c of data.courses) {
    if (!learnIsUuid(c.id)) return { ok: false, error: 'Pole "course.id" musi być identyfikatorem UUID.' };
    for (const field of ['slug', 'title', 'shortTitle', 'description', 'shortDescription', 'icon', 'accent']) {
      if (!c[field] || typeof c[field] !== 'string') return { ok: false, error: `Pole "course.${field}" jest wymagane i musi być tekstem.` };
    }
    if (!Array.isArray(c.modules) || c.modules.length === 0) return { ok: false, error: `Kurs "${c.slug}" musi mieć niepustą listę "modules" (referencje "module_id").` };
    for (const ref of c.modules) {
      if (!learnIsUuid(ref.module_id) || !moduleById.has(ref.module_id)) return { ok: false, error: `Kurs "${c.slug}" odwołuje się do nieistniejącego modułu "module_id": "${ref.module_id}".` };
      const m = moduleById.get(ref.module_id);
      const key = c.id + '::' + m.slug;
      if (moduleSlugsPerCourse.has(key)) return { ok: false, error: `Zduplikowany slug modułu "${m.slug}" w kursie "${c.slug}".` };
      moduleSlugsPerCourse.add(key);
    }
  }

  return { ok: true };
}

/* Validates and upserts a course.json's rows into the local DB (replacing
 * any existing rows for the same course id, so re-importing/re-seeding
 * updates it cleanly). Returns { ok: true, slug } or { ok: false, error }. */
function learnImportCourse(data) {
  const result = learnValidateCourseData(data);
  if (!result.ok) return result;

  const db = learnLoadDB();
  data.courses.forEach(c => learnRemoveCourseRows(db, c.id));
  data.courses.forEach(c => db.courses.push(c));
  data.modules.forEach(m => db.modules.push(m));
  data.items.forEach(it => db.items.push(it));
  learnSaveDB(db);

  return { ok: true, slug: data.courses[0].slug };
}
