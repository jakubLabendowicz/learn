/* Per-user activity: visit tracking (userCourseActivities/
 * userModuleActivities/userArticleActivities/userQuizActivities) and quiz
 * attempt history (userQuizAttempts), stored as tables in the same local
 * DB as courses/modules/articles/quizes (see imported-courses.js).
 * Single-table reads/writes go through the LearnDB ORM (storage.js);
 * multi-table joins (progress, recent-activity summaries) fall back to
 * learnLoadDB for a consistent whole-DB snapshot. */

// ---------------- Touch (visit tracking) ----------------

function learnTouchUserCourse(userId, courseId) {
  const now = new Date().toISOString();
  return LearnDB.userCourseActivities.upsert(
    r => r.userId === userId && r.courseId === courseId,
    () => ({ id: learnUuid(), userId, courseId, firstVisitedAt: now, lastVisitedAt: now, customAccent: null }),
    { lastVisitedAt: now }
  );
}

function learnTouchUserModule(userId, moduleId) {
  const now = new Date().toISOString();
  return LearnDB.userModuleActivities.upsert(
    r => r.userId === userId && r.moduleId === moduleId,
    () => ({ id: learnUuid(), userId, moduleId, firstVisitedAt: now, lastVisitedAt: now }),
    { lastVisitedAt: now }
  );
}

function learnTouchUserArticle(userId, articleId) {
  const now = new Date().toISOString();
  return LearnDB.userArticleActivities.upsert(
    r => r.userId === userId && r.articleId === articleId,
    () => ({ id: learnUuid(), userId, articleId, firstVisitedAt: now, lastVisitedAt: now }),
    { lastVisitedAt: now }
  );
}

function learnTouchUserQuiz(userId, quizId) {
  const now = new Date().toISOString();
  return LearnDB.userQuizActivities.upsert(
    r => r.userId === userId && r.quizId === quizId,
    () => ({ id: learnUuid(), userId, quizId, firstVisitedAt: now, lastVisitedAt: now }),
    { lastVisitedAt: now }
  );
}

function learnUserCourseRow(userId, courseId) {
  return LearnDB.userCourseActivities.first(r => r.userId === userId && r.courseId === courseId);
}

function learnSetCourseCustomAccent(userId, courseId, accent) {
  const row = learnTouchUserCourse(userId, courseId);
  return LearnDB.userCourseActivities.update(row.id, { customAccent: accent || null });
}

// ---------------- Quiz attempts ----------------

function learnRecordQuizAttempt(userId, quizId, result) {
  return LearnDB.userQuizAttempts.insert({
    id: learnUuid(),
    userId,
    quizId,
    date: new Date().toISOString(),
    answers: result.answers,
    score: result.score,
    total: result.total,
    pct: result.pct,
  });
}

function learnHasVisitedArticle(userId, articleId) {
  return LearnDB.userArticleActivities.count(r => r.userId === userId && r.articleId === articleId) > 0;
}

function learnQuizAttemptsFor(userId, quizId) {
  return LearnDB.userQuizAttempts.where(r => r.userId === userId && r.quizId === quizId);
}

function learnBestAttempt(attempts) {
  if (!attempts.length) return null;
  return attempts.reduce((best, a) => (!best || a.pct > best.pct ? a : best), null);
}

// ---------------- Progress ----------------

function learnCourseProgress(userId, courseId) {
  const db = learnLoadDB();
  const course = db.courses.find(c => c.id === courseId);
  if (!course) return 0;
  const data = learnGetCourseData(course.slug);
  if (!data) return 0;
  const articleIds = new Set(data.modules.flatMap(m => m.articles).map(a => a.id));
  const quizIds = new Set(data.modules.flatMap(m => m.quizzes).map(q => q.id));
  const totalItems = articleIds.size + quizIds.size;
  if (!totalItems) return 0;
  const readCount = db.userArticleActivities.filter(r => r.userId === userId && articleIds.has(r.articleId)).length;
  const attemptedQuizIds = new Set(
    db.userQuizAttempts.filter(r => r.userId === userId && quizIds.has(r.quizId)).map(r => r.quizId)
  );
  const doneCount = readCount + attemptedQuizIds.size;
  return Math.min(100, Math.round((doneCount / totalItems) * 100));
}

// ---------------- Homepage / profile summaries ----------------

function learnRecentCourses(userId, limit) {
  const db = learnLoadDB();
  return db.userCourseActivities
    .filter(r => r.userId === userId)
    .slice()
    .sort((a, b) => new Date(b.lastVisitedAt) - new Date(a.lastVisitedAt))
    .slice(0, limit || 5)
    .map(r => {
      const course = db.courses.find(c => c.id === r.courseId);
      if (!course) return null;
      return {
        id: course.id,
        slug: course.slug,
        title: course.title,
        shortTitle: course.shortTitle,
        icon: course.icon,
        accent: r.customAccent || course.accent,
        firstVisitedAt: r.firstVisitedAt,
        lastVisitedAt: r.lastVisitedAt,
        pct: learnCourseProgress(userId, course.id),
      };
    })
    .filter(Boolean);
}

// Recently read articles, for the homepage's "Ostatnie moduły" list.
function learnRecentModules(userId, limit) {
  const db = learnLoadDB();
  const rows = db.userArticleActivities.filter(r => r.userId === userId).slice().sort((a, b) => new Date(b.lastVisitedAt) - new Date(a.lastVisitedAt));
  const events = [];
  for (const r of rows) {
    const article = db.articles.find(a => a.id === r.articleId);
    if (!article) continue;
    const mod = learnFindModuleForArticle(article.id);
    const course = mod && learnFindCourseForModule(mod.id);
    if (!mod || !course) continue;
    events.push({
      courseSlug: course.slug, courseTitle: course.title, courseShortTitle: course.shortTitle,
      itemTitle: article.title, itemShortTitle: article.shortTitle, date: r.lastVisitedAt,
    });
    if (events.length >= (limit || 6)) break;
  }
  return events;
}

function learnRecentResults(userId, limit) {
  const db = learnLoadDB();
  return db.userQuizAttempts
    .filter(r => r.userId === userId)
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit || 6)
    .map(r => {
      const quiz = db.quizes.find(q => q.id === r.quizId);
      const mod = quiz && learnFindModuleForQuiz(quiz.id);
      const course = mod && learnFindCourseForModule(mod.id);
      if (!quiz || !mod || !course) return null;
      return {
        courseSlug: course.slug, courseTitle: course.title, courseShortTitle: course.shortTitle,
        itemTitle: quiz.title, itemShortTitle: quiz.shortTitle,
        score: r.score, total: r.total, pct: r.pct, date: r.date,
      };
    })
    .filter(Boolean);
}
