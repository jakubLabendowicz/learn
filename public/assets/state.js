/* Per-user activity: visit tracking (userCourseActivities/
 * userModuleActivities/userArticleActivities/userQuizActivities) and quiz
 * attempt history (userQuizAttempts), stored as tables in the same local
 * DB as courses/modules/articles/quizes (see imported-courses.js). */

// ---------------- Touch (visit tracking) ----------------

function learnTouchUserCourse(userId, courseId) {
  const db = learnLoadDB();
  const now = new Date().toISOString();
  let row = db.userCourseActivities.find(r => r.userId === userId && r.courseId === courseId);
  if (!row) {
    row = { id: learnUuid(), userId, courseId, firstVisitedAt: now, lastVisitedAt: now, customAccent: null };
    db.userCourseActivities.push(row);
  } else {
    row.lastVisitedAt = now;
  }
  learnSaveDB(db);
  return row;
}

function learnTouchUserModule(userId, moduleId) {
  const db = learnLoadDB();
  const now = new Date().toISOString();
  let row = db.userModuleActivities.find(r => r.userId === userId && r.moduleId === moduleId);
  if (!row) {
    row = { id: learnUuid(), userId, moduleId, firstVisitedAt: now, lastVisitedAt: now };
    db.userModuleActivities.push(row);
  } else {
    row.lastVisitedAt = now;
  }
  learnSaveDB(db);
  return row;
}

function learnTouchUserArticle(userId, articleId) {
  const db = learnLoadDB();
  const now = new Date().toISOString();
  let row = db.userArticleActivities.find(r => r.userId === userId && r.articleId === articleId);
  if (!row) {
    row = { id: learnUuid(), userId, articleId, firstVisitedAt: now, lastVisitedAt: now };
    db.userArticleActivities.push(row);
  } else {
    row.lastVisitedAt = now;
  }
  learnSaveDB(db);
  return row;
}

function learnTouchUserQuiz(userId, quizId) {
  const db = learnLoadDB();
  const now = new Date().toISOString();
  let row = db.userQuizActivities.find(r => r.userId === userId && r.quizId === quizId);
  if (!row) {
    row = { id: learnUuid(), userId, quizId, firstVisitedAt: now, lastVisitedAt: now };
    db.userQuizActivities.push(row);
  } else {
    row.lastVisitedAt = now;
  }
  learnSaveDB(db);
  return row;
}

function learnUserCourseRow(userId, courseId) {
  const db = learnLoadDB();
  return db.userCourseActivities.find(r => r.userId === userId && r.courseId === courseId) || null;
}

function learnSetCourseCustomAccent(userId, courseId, accent) {
  const row = learnTouchUserCourse(userId, courseId);
  const db = learnLoadDB();
  const found = db.userCourseActivities.find(r => r.id === row.id);
  found.customAccent = accent || null;
  learnSaveDB(db);
  return found;
}

// ---------------- Quiz attempts ----------------

function learnRecordQuizAttempt(userId, quizId, result) {
  const db = learnLoadDB();
  const row = {
    id: learnUuid(),
    userId,
    quizId,
    date: new Date().toISOString(),
    answers: result.answers,
    score: result.score,
    total: result.total,
    pct: result.pct,
  };
  db.userQuizAttempts.unshift(row);
  learnSaveDB(db);
  return row;
}

function learnHasVisitedArticle(userId, articleId) {
  const db = learnLoadDB();
  return db.userArticleActivities.some(r => r.userId === userId && r.articleId === articleId);
}

function learnQuizAttemptsFor(userId, quizId) {
  const db = learnLoadDB();
  return db.userQuizAttempts.filter(r => r.userId === userId && r.quizId === quizId);
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
