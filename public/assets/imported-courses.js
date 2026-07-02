/* Local "database": courses, question sets/questions, modules,
 * articles/quizes (linked to their question sets via quizQuestionSets),
 * the user(s), and per-user activity — stored as normalized tables
 * (UUID ids, id-reference relations) in a single localStorage key. This
 * is the app's only source of data — built-in courses and a default user
 * are seeded here on first load (see learnEnsureSeeded), and every page
 * reads exclusively from here afterwards, whether a course is built-in or
 * user-imported.
 *
 * Relations are FK-on-child (child rows point at their parent via an
 * *Id field), e.g. module.courseId, article.moduleId, quiz.moduleId,
 * question.questionSetId — the reverse of pointing from parent to child. */
const LEARN_DB_KEY = 'learn:db:v1';
const LEARN_SEEDED_KEY = 'learn:seeded-builtin:v1';
const LEARN_DB_DEFAULTS = {
  courses: [], questionSets: [], questions: [], modules: [], articles: [], quizes: [], quizQuestionSets: [],
  users: [],
  userCourseActivities: [], userModuleActivities: [], userArticleActivities: [], userQuizActivities: [], userQuizAttempts: [],
};

function learnUuid() { return crypto.randomUUID(); }

function learnLoadDB() {
  try {
    const raw = localStorage.getItem(LEARN_DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return Object.assign({}, LEARN_DB_DEFAULTS, parsed);
    }
  } catch (e) {}
  return Object.assign({}, LEARN_DB_DEFAULTS);
}

function learnSaveDB(db) {
  localStorage.setItem(LEARN_DB_KEY, JSON.stringify(db));
}

/* Creates the single local user the first time the app ever runs. */
function learnEnsureDefaultUser() {
  const db = learnLoadDB();
  if (db.users.length > 0) return;
  db.users.push({
    id: learnUuid(),
    name: 'Gość',
    email: '',
    bio: '',
    avatarIcon: '🙂',
    createdAt: new Date().toISOString(),
  });
  learnSaveDB(db);
}

/* This app has exactly one local user (no accounts/auth) — this is them. */
function learnCurrentUser() {
  const db = learnLoadDB();
  return db.users[0] || null;
}

function learnUpdateUser(userId, patch) {
  const db = learnLoadDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return null;
  Object.assign(user, patch);
  learnSaveDB(db);
  return user;
}

/* Seeds the built-in courses (listed in /courses/manifest.json) and the
 * default user into the local DB the first time the app ever runs. A
 * no-op on every later call (including after the user deletes a built-in
 * course — it stays deleted). */
async function learnEnsureSeeded() {
  learnEnsureDefaultUser();
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

/* Graph-traversal helpers shared by state.js and profile.html. */
function learnFindModuleForArticle(articleId) {
  const db = learnLoadDB();
  const article = db.articles.find(a => a.id === articleId);
  return article ? db.modules.find(m => m.id === article.moduleId) || null : null;
}

function learnFindModuleForQuiz(quizId) {
  const db = learnLoadDB();
  const quiz = db.quizes.find(q => q.id === quizId);
  return quiz ? db.modules.find(m => m.id === quiz.moduleId) || null : null;
}

function learnFindCourseForModule(moduleId) {
  const db = learnLoadDB();
  const mod = db.modules.find(m => m.id === moduleId);
  return mod ? db.courses.find(c => c.id === mod.courseId) || null : null;
}

/* Resolves a quiz's full question pool (in quizQuestionSets order) as
 * { question, weight } — each question annotated with the weight of the
 * question set it came from, for proportional sampling. */
function learnQuizQuestionPool(db, quizId) {
  const refs = db.quizQuestionSets.filter(r => r.quizId === quizId);
  return refs.map(ref => ({
    questionSetId: ref.questionSetId,
    weight: ref.weight,
    questions: db.questions.filter(q => q.questionSetId === ref.questionSetId),
  }));
}

/* Resolves a course by slug into { course, modules }, where each module
 * has its "articles" and "quizzes" resolved into full objects (in
 * course/module order), each quiz further carrying a resolved
 * "questionSets" array ({ questionSetId, weight, questions }) — the
 * shape the course engine renders directly. */
function learnGetCourseData(slug) {
  const db = learnLoadDB();
  const course = db.courses.find(c => c.slug === slug);
  if (!course) return null;
  const modules = db.modules
    .filter(m => m.courseId === course.id)
    .map(m => {
      const articles = db.articles.filter(a => a.moduleId === m.id);
      const quizzes = db.quizes.filter(q => q.moduleId === m.id).map(q => Object.assign({}, q, {
        questionSets: learnQuizQuestionPool(db, q.id),
      }));
      return Object.assign({}, m, { articles, quizzes });
    });
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
    moduleCount: db.modules.filter(m => m.courseId === c.id).length,
  }));
}

/* Removes a course's own row plus every module/article/quiz/questionSet/
 * question it (exclusively) owns, and cascades into per-user activity
 * referencing any of them. */
function learnRemoveCourseRows(db, courseId) {
  const course = db.courses.find(c => c.id === courseId);
  if (!course) return;
  const moduleIds = new Set(db.modules.filter(m => m.courseId === courseId).map(m => m.id));
  const articleIds = new Set(db.articles.filter(a => moduleIds.has(a.moduleId)).map(a => a.id));
  const quizIds = new Set(db.quizes.filter(q => moduleIds.has(q.moduleId)).map(q => q.id));
  const questionSetIds = new Set(db.questionSets.filter(qs => qs.courseId === courseId).map(qs => qs.id));

  db.courses = db.courses.filter(c => c.id !== courseId);
  db.modules = db.modules.filter(m => !moduleIds.has(m.id));
  db.articles = db.articles.filter(a => !articleIds.has(a.id));
  db.quizes = db.quizes.filter(q => !quizIds.has(q.id));
  db.questionSets = db.questionSets.filter(qs => !questionSetIds.has(qs.id));
  db.questions = db.questions.filter(q => !questionSetIds.has(q.questionSetId));
  db.quizQuestionSets = db.quizQuestionSets.filter(r => !quizIds.has(r.quizId) && !questionSetIds.has(r.questionSetId));

  db.userCourseActivities = db.userCourseActivities.filter(r => r.courseId !== courseId);
  db.userModuleActivities = db.userModuleActivities.filter(r => !moduleIds.has(r.moduleId));
  db.userArticleActivities = db.userArticleActivities.filter(r => !articleIds.has(r.articleId));
  db.userQuizActivities = db.userQuizActivities.filter(r => !quizIds.has(r.quizId));
  db.userQuizAttempts = db.userQuizAttempts.filter(r => !quizIds.has(r.quizId));
}

function learnDeleteCourse(slug) {
  const db = learnLoadDB();
  const course = db.courses.find(c => c.slug === slug);
  if (course) learnRemoveCourseRows(db, course.id);
  learnSaveDB(db);
}

/* Downloads the normalized 7-table subgraph for one course as a
 * course.json file. */
function learnExportCourse(slug) {
  const db = learnLoadDB();
  const course = db.courses.find(c => c.slug === slug);
  if (!course) { alert('Nie udało się znaleźć kursu do eksportu.'); return; }
  const modules = db.modules.filter(m => m.courseId === course.id);
  const moduleIds = new Set(modules.map(m => m.id));
  const articles = db.articles.filter(a => moduleIds.has(a.moduleId));
  const quizes = db.quizes.filter(q => moduleIds.has(q.moduleId));
  const quizIds = new Set(quizes.map(q => q.id));
  const quizQuestionSets = db.quizQuestionSets.filter(r => quizIds.has(r.quizId));
  const questionSetIds = new Set(quizQuestionSets.map(r => r.questionSetId));
  const questionSets = db.questionSets.filter(qs => questionSetIds.has(qs.id));
  const questions = db.questions.filter(q => questionSetIds.has(q.questionSetId));
  const data = { courses: [course], questionSets, questions, modules, articles, quizes, quizQuestionSets };
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

/* Validates the normalized 7-table shape, including referential integrity
 * across courses/questionSets/questions/modules/articles/quizes/
 * quizQuestionSets. Returns { ok: true } or { ok: false, error: string }. */
function learnValidateCourseData(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Plik nie zawiera poprawnego obiektu JSON.' };
  if (!Array.isArray(data.courses) || data.courses.length === 0) return { ok: false, error: 'Pole "courses" musi być niepustą tablicą.' };
  if (!Array.isArray(data.questionSets)) return { ok: false, error: 'Pole "questionSets" musi być tablicą.' };
  if (!Array.isArray(data.questions)) return { ok: false, error: 'Pole "questions" musi być tablicą.' };
  if (!Array.isArray(data.modules)) return { ok: false, error: 'Pole "modules" musi być tablicą.' };
  if (!Array.isArray(data.articles)) return { ok: false, error: 'Pole "articles" musi być tablicą.' };
  if (!Array.isArray(data.quizes)) return { ok: false, error: 'Pole "quizes" musi być tablicą.' };
  if (!Array.isArray(data.quizQuestionSets)) return { ok: false, error: 'Pole "quizQuestionSets" musi być tablicą.' };

  const courseById = new Map();
  for (const c of data.courses) {
    if (!learnIsUuid(c.id)) return { ok: false, error: 'Pole "course.id" musi być identyfikatorem UUID.' };
    if (courseById.has(c.id)) return { ok: false, error: `Zduplikowany "id" kursu: "${c.id}".` };
    for (const field of ['slug', 'title', 'shortTitle', 'description', 'shortDescription', 'icon', 'accent']) {
      if (!c[field] || typeof c[field] !== 'string') return { ok: false, error: `Pole "course.${field}" jest wymagane i musi być tekstem.` };
    }
    courseById.set(c.id, c);
  }

  const questionSetById = new Map();
  for (const qs of data.questionSets) {
    if (!learnIsUuid(qs.id)) return { ok: false, error: `Pole "id" zestawu pytań musi być identyfikatorem UUID (znaleziono: "${qs.id}").` };
    if (questionSetById.has(qs.id)) return { ok: false, error: `Zduplikowany "id" zestawu pytań: "${qs.id}".` };
    if (!learnIsUuid(qs.courseId) || !courseById.has(qs.courseId)) return { ok: false, error: `Zestaw pytań "${qs.id}" odwołuje się do nieistniejącego kursu "courseId": "${qs.courseId}".` };
    questionSetById.set(qs.id, qs);
  }

  const questionSetHasQuestion = new Map();
  for (const q of data.questions) {
    if (!learnIsUuid(q.id)) return { ok: false, error: `Pole "id" pytania musi być identyfikatorem UUID (znaleziono: "${q.id}").` };
    if (!learnIsUuid(q.questionSetId) || !questionSetById.has(q.questionSetId)) return { ok: false, error: `Pytanie "${q.id}" odwołuje się do nieistniejącego zestawu pytań "questionSetId": "${q.questionSetId}".` };
    if (!q.question || typeof q.question !== 'string') return { ok: false, error: `Pytanie "${q.id}" wymaga pola "question" (tekst).` };
    if (!Array.isArray(q.options) || q.options.length < 2) return { ok: false, error: `Pytanie "${q.id}" musi mieć co najmniej 2 elementy w "options".` };
    let correctCount = 0;
    for (const o of q.options) {
      if (!learnIsUuid(o.id)) return { ok: false, error: `Pole "id" odpowiedzi w pytaniu "${q.id}" musi być identyfikatorem UUID.` };
      if (!o.text || typeof o.text !== 'string') return { ok: false, error: `Każda odpowiedź w pytaniu "${q.id}" wymaga pola "text" (tekst).` };
      if (typeof o.correct !== 'boolean') return { ok: false, error: `Każda odpowiedź w pytaniu "${q.id}" wymaga pola "correct" (boolean).` };
      if (o.correct) correctCount++;
    }
    if (correctCount < 1) return { ok: false, error: `Pytanie "${q.id}" musi mieć co najmniej jedną odpowiedź "correct": true.` };
    if (typeof q.explanation !== 'string') return { ok: false, error: `Pytanie "${q.id}" wymaga pola "explanation" (tekst).` };
    questionSetHasQuestion.set(q.questionSetId, true);
  }

  const moduleById = new Map();
  for (const m of data.modules) {
    if (!learnIsUuid(m.id)) return { ok: false, error: `Pole "id" modułu "${m.slug || m.title || '?'}" musi być identyfikatorem UUID.` };
    if (moduleById.has(m.id)) return { ok: false, error: `Zduplikowany "id" modułu: "${m.id}".` };
    if (!learnIsUuid(m.courseId) || !courseById.has(m.courseId)) return { ok: false, error: `Moduł "${m.slug || m.id}" odwołuje się do nieistniejącego kursu "courseId": "${m.courseId}".` };
    for (const field of ['slug', 'title', 'shortTitle', 'description', 'shortDescription', 'icon', 'accent']) {
      if (!m[field] || typeof m[field] !== 'string') return { ok: false, error: `Moduł "${m.slug || m.title || m.id}" wymaga pola "${field}" (tekst).` };
    }
    moduleById.set(m.id, m);
  }

  const slugsByModule = new Map();
  function checkModuleSlug(m, slug, kind) {
    if (!moduleById.has(m.id)) return;
    if (!slugsByModule.has(m.id)) slugsByModule.set(m.id, new Set());
    const set = slugsByModule.get(m.id);
    if (set.has(slug)) return `Zduplikowany slug "${slug}" w module "${m.slug}" (slug musi być unikalny w obrębie modułu, niezależnie od typu artykuł/quiz).`;
    set.add(slug);
    return null;
  }

  const articleById = new Map();
  for (const a of data.articles) {
    if (!learnIsUuid(a.id)) return { ok: false, error: `Pole "id" artykułu "${a.slug || a.title || '?'}" musi być identyfikatorem UUID.` };
    if (articleById.has(a.id)) return { ok: false, error: `Zduplikowany "id" artykułu: "${a.id}".` };
    if (!learnIsUuid(a.moduleId) || !moduleById.has(a.moduleId)) return { ok: false, error: `Artykuł "${a.slug || a.id}" odwołuje się do nieistniejącego modułu "moduleId": "${a.moduleId}".` };
    for (const field of ['slug', 'title', 'shortTitle', 'description', 'shortDescription', 'content']) {
      if (!a[field] || typeof a[field] !== 'string') return { ok: false, error: `Artykuł "${a.slug || a.id}" wymaga pola "${field}" (tekst).` };
    }
    const dupErr = checkModuleSlug(moduleById.get(a.moduleId), a.slug, 'artykuł');
    if (dupErr) return { ok: false, error: dupErr };
    articleById.set(a.id, a);
  }

  const quizById = new Map();
  for (const q of data.quizes) {
    if (!learnIsUuid(q.id)) return { ok: false, error: `Pole "id" quizu "${q.slug || q.title || '?'}" musi być identyfikatorem UUID.` };
    if (quizById.has(q.id)) return { ok: false, error: `Zduplikowany "id" quizu: "${q.id}".` };
    if (!learnIsUuid(q.moduleId) || !moduleById.has(q.moduleId)) return { ok: false, error: `Quiz "${q.slug || q.id}" odwołuje się do nieistniejącego modułu "moduleId": "${q.moduleId}".` };
    for (const field of ['slug', 'title', 'shortTitle', 'description', 'shortDescription']) {
      if (!q[field] || typeof q[field] !== 'string') return { ok: false, error: `Quiz "${q.slug || q.id}" wymaga pola "${field}" (tekst).` };
    }
    if (!('passThreshold' in q) || (q.passThreshold !== null && typeof q.passThreshold !== 'number')) {
      return { ok: false, error: `Quiz "${q.slug}" wymaga pola "passThreshold" (liczba lub null).` };
    }
    const dupErr = checkModuleSlug(moduleById.get(q.moduleId), q.slug, 'quiz');
    if (dupErr) return { ok: false, error: dupErr };
    quizById.set(q.id, q);
  }

  const quizHasQuestionSet = new Map();
  for (const ref of data.quizQuestionSets) {
    if (!learnIsUuid(ref.quizId) || !quizById.has(ref.quizId)) return { ok: false, error: `Pozycja "quizQuestionSets" odwołuje się do nieistniejącego quizu "quizId": "${ref.quizId}".` };
    if (!learnIsUuid(ref.questionSetId) || !questionSetById.has(ref.questionSetId)) return { ok: false, error: `Pozycja "quizQuestionSets" quizu "${ref.quizId}" odwołuje się do nieistniejącego zestawu pytań "questionSetId": "${ref.questionSetId}".` };
    if (typeof ref.weight !== 'number') return { ok: false, error: `Każda pozycja "quizQuestionSets" wymaga liczbowego pola "weight" (quiz "${ref.quizId}").` };
    quizHasQuestionSet.set(ref.quizId, true);
  }

  for (const q of data.quizes) {
    if (!quizHasQuestionSet.get(q.id)) return { ok: false, error: `Quiz "${q.slug}" musi mieć co najmniej jedną pozycję w "quizQuestionSets".` };
  }
  for (const qs of data.questionSets) {
    if (!questionSetHasQuestion.get(qs.id)) return { ok: false, error: `Zestaw pytań "${qs.id}" musi mieć co najmniej jedno pytanie.` };
  }

  const moduleSlugsPerCourse = new Set();
  for (const m of data.modules) {
    const key = m.courseId + '::' + m.slug;
    if (moduleSlugsPerCourse.has(key)) return { ok: false, error: `Zduplikowany slug modułu "${m.slug}" w kursie "${(courseById.get(m.courseId) || {}).slug || m.courseId}".` };
    moduleSlugsPerCourse.add(key);
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
  data.questionSets.forEach(qs => db.questionSets.push(qs));
  data.questions.forEach(q => db.questions.push(q));
  data.modules.forEach(m => db.modules.push(m));
  data.articles.forEach(a => db.articles.push(a));
  data.quizes.forEach(q => db.quizes.push(q));
  data.quizQuestionSets.forEach(r => db.quizQuestionSets.push(r));
  learnSaveDB(db);

  return { ok: true, slug: data.courses[0].slug };
}
