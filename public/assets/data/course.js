/* Course: the top-level entity. A course.json import graph is validated
 * and upserted here, cascading into every table that (transitively)
 * belongs to the course — modules, articles, quizzes, question sets,
 * questions, quizQuestionSets and per-user activity referencing any of
 * them. */
class CourseDao extends Dao {
  constructor() { super('courses'); }
  bySlug(slug) { return this.first(c => c.slug === slug); }
}

class CourseRepository extends Repository {
  constructor() { super(new CourseDao()); }

  bySlug(slug) { return this.dao.bySlug(slug); }

  // Resolves a course by slug into { course, modules }, where each module
  // has its "articles" and "quizzes" resolved into full objects (in
  // course/module order), each quiz further carrying a resolved
  // "questionSets" array ({ questionSetId, weight, questions }) — the
  // shape the course engine renders directly.
  getCourseData(slug) {
    const course = this.bySlug(slug);
    if (!course) return null;
    const modules = moduleRepository.forCourse(course.id).map(m => moduleRepository.withItems(m));
    return { course, modules };
  }

  // Lightweight summaries for listing pages (course grid, import page).
  listSummaries() {
    return this.all().map(c => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      shortTitle: c.shortTitle,
      description: c.description,
      shortDescription: c.shortDescription,
      icon: c.icon,
      accent: c.accent,
      moduleCount: moduleRepository.forCourse(c.id).length,
    }));
  }

  // Removes a course's own row plus every module/article/quiz/questionSet/
  // question it (exclusively) owns, and cascades into per-user activity
  // referencing any of them.
  cascadeDelete(courseId) {
    const course = this.dao.find(courseId);
    if (!course) return;
    const moduleIds = new Set(moduleRepository.forCourse(courseId).map(m => m.id));
    const articleIds = new Set(articleRepository.where(a => moduleIds.has(a.moduleId)).map(a => a.id));
    const quizIds = new Set(quizRepository.where(q => moduleIds.has(q.moduleId)).map(q => q.id));
    const questionSetIds = new Set(questionSetRepository.forCourse(courseId).map(qs => qs.id));

    this.remove(courseId);
    moduleRepository.removeWhere(m => moduleIds.has(m.id));
    articleRepository.removeWhere(a => articleIds.has(a.id));
    quizRepository.removeWhere(q => quizIds.has(q.id));
    questionSetRepository.removeWhere(qs => questionSetIds.has(qs.id));
    questionRepository.removeWhere(q => questionSetIds.has(q.questionSetId));
    quizQuestionSetRepository.removeWhere(r => quizIds.has(r.quizId) || questionSetIds.has(r.questionSetId));

    userCourseActivityRepository.removeWhere(r => r.courseId === courseId);
    userModuleActivityRepository.removeWhere(r => moduleIds.has(r.moduleId));
    userArticleActivityRepository.removeWhere(r => articleIds.has(r.articleId));
    userQuizActivityRepository.removeWhere(r => quizIds.has(r.quizId));
    userQuizAttemptRepository.removeWhere(r => quizIds.has(r.quizId));
  }

  deleteBySlug(slug) {
    const course = this.bySlug(slug);
    if (course) this.cascadeDelete(course.id);
  }

  // Builds the normalized 7-table subgraph for one course, ready to
  // serialize as a course.json file.
  buildExportData(slug) {
    const course = this.bySlug(slug);
    if (!course) return null;
    const modules = moduleRepository.forCourse(course.id);
    const moduleIds = new Set(modules.map(m => m.id));
    const articles = articleRepository.where(a => moduleIds.has(a.moduleId));
    const quizes = quizRepository.where(q => moduleIds.has(q.moduleId));
    const quizIds = new Set(quizes.map(q => q.id));
    const quizQuestionSets = quizQuestionSetRepository.where(r => quizIds.has(r.quizId));
    const questionSetIds = new Set(quizQuestionSets.map(r => r.questionSetId));
    const questionSets = questionSetRepository.where(qs => questionSetIds.has(qs.id));
    const questions = questionRepository.where(q => questionSetIds.has(q.questionSetId));
    return { courses: [course], questionSets, questions, modules, articles, quizes, quizQuestionSets };
  }

  // Validates the normalized 7-table shape, including referential
  // integrity across courses/questionSets/questions/modules/articles/
  // quizes/quizQuestionSets. Returns { ok: true } or
  // { ok: false, error: string }.
  validate(data) {
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
    function checkModuleSlug(m, slug) {
      if (!moduleById.has(m.id)) return null;
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
      const dupErr = checkModuleSlug(moduleById.get(a.moduleId), a.slug);
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
      const dupErr = checkModuleSlug(moduleById.get(q.moduleId), q.slug);
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

  // Validates and upserts a course.json's rows into the local DB
  // (replacing any existing rows for the same course id, so
  // re-importing/re-seeding updates it cleanly). Returns
  // { ok: true, slug } or { ok: false, error }.
  importCourse(data) {
    const result = this.validate(data);
    if (!result.ok) return result;

    data.courses.forEach(c => this.cascadeDelete(c.id));
    data.courses.forEach(c => this.insert(c));
    questionSetRepository.insertMany(data.questionSets);
    questionRepository.insertMany(data.questions);
    moduleRepository.insertMany(data.modules);
    articleRepository.insertMany(data.articles);
    quizRepository.insertMany(data.quizes);
    quizQuestionSetRepository.insertMany(data.quizQuestionSets);

    return { ok: true, slug: data.courses[0].slug };
  }

  // Percentage of a course's articles/quizzes the user has read/attempted.
  getProgress(userId, courseId) {
    const course = this.dao.find(courseId);
    if (!course) return 0;
    const data = this.getCourseData(course.slug);
    if (!data) return 0;
    const articleIds = new Set(data.modules.flatMap(m => m.articles).map(a => a.id));
    const quizIds = new Set(data.modules.flatMap(m => m.quizzes).map(q => q.id));
    const totalItems = articleIds.size + quizIds.size;
    if (!totalItems) return 0;
    const readCount = userArticleActivityRepository.where(r => r.userId === userId && articleIds.has(r.articleId)).length;
    const attemptedQuizIds = new Set(
      userQuizAttemptRepository.where(r => r.userId === userId && quizIds.has(r.quizId)).map(r => r.quizId)
    );
    const doneCount = readCount + attemptedQuizIds.size;
    return Math.min(100, Math.round((doneCount / totalItems) * 100));
  }
}

const courseRepository = new CourseRepository();
