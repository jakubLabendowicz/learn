/* Per-user activity: visit tracking (userCourses/userModules/userItems)
 * and quiz attempt history (userQuizAttempts), stored as tables in the
 * same local DB as courses/modules/items (see imported-courses.js). */

// ---------------- Touch (visit tracking) ----------------

function learnTouchUserCourse(userId, courseId) {
  const db = learnLoadDB();
  const now = new Date().toISOString();
  let row = db.userCourses.find(r => r.userId === userId && r.courseId === courseId);
  if (!row) {
    row = { id: learnUuid(), userId, courseId, firstVisitedAt: now, lastVisitedAt: now, customAccent: null };
    db.userCourses.push(row);
  } else {
    row.lastVisitedAt = now;
  }
  learnSaveDB(db);
  return row;
}

function learnTouchUserModule(userId, moduleId) {
  const db = learnLoadDB();
  const now = new Date().toISOString();
  let row = db.userModules.find(r => r.userId === userId && r.moduleId === moduleId);
  if (!row) {
    row = { id: learnUuid(), userId, moduleId, firstVisitedAt: now, lastVisitedAt: now };
    db.userModules.push(row);
  } else {
    row.lastVisitedAt = now;
  }
  learnSaveDB(db);
  return row;
}

function learnTouchUserItem(userId, itemId) {
  const db = learnLoadDB();
  const now = new Date().toISOString();
  let row = db.userItems.find(r => r.userId === userId && r.itemId === itemId);
  if (!row) {
    row = { id: learnUuid(), userId, itemId, firstVisitedAt: now, lastVisitedAt: now };
    db.userItems.push(row);
  } else {
    row.lastVisitedAt = now;
  }
  learnSaveDB(db);
  return row;
}

function learnUserCourseRow(userId, courseId) {
  const db = learnLoadDB();
  return db.userCourses.find(r => r.userId === userId && r.courseId === courseId) || null;
}

function learnSetCourseCustomAccent(userId, courseId, accent) {
  const row = learnTouchUserCourse(userId, courseId);
  const db = learnLoadDB();
  const found = db.userCourses.find(r => r.id === row.id);
  found.customAccent = accent || null;
  learnSaveDB(db);
  return found;
}

// ---------------- Quiz attempts ----------------

function learnRecordQuizAttempt(userId, itemId, result) {
  const db = learnLoadDB();
  const row = {
    id: learnUuid(),
    userId,
    itemId,
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

function learnHasVisitedItem(userId, itemId) {
  const db = learnLoadDB();
  return db.userItems.some(r => r.userId === userId && r.itemId === itemId);
}

function learnQuizAttemptsFor(userId, itemId) {
  const db = learnLoadDB();
  return db.userQuizAttempts.filter(r => r.userId === userId && r.itemId === itemId);
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
  const allItems = data.modules.flatMap(m => m.items);
  const totalItems = allItems.length;
  if (!totalItems) return 0;
  const articleIds = new Set(allItems.filter(it => it.type === 'article').map(it => it.id));
  const quizIds = new Set(allItems.filter(it => it.type !== 'article').map(it => it.id));
  const readCount = db.userItems.filter(r => r.userId === userId && articleIds.has(r.itemId)).length;
  const attemptedQuizIds = new Set(
    db.userQuizAttempts.filter(r => r.userId === userId && quizIds.has(r.itemId)).map(r => r.itemId)
  );
  const doneCount = readCount + attemptedQuizIds.size;
  return Math.min(100, Math.round((doneCount / totalItems) * 100));
}

// ---------------- Homepage / profile summaries ----------------

function learnRecentCourses(userId, limit) {
  const db = learnLoadDB();
  return db.userCourses
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
  const rows = db.userItems.filter(r => r.userId === userId).slice().sort((a, b) => new Date(b.lastVisitedAt) - new Date(a.lastVisitedAt));
  const events = [];
  for (const r of rows) {
    const item = db.items.find(it => it.id === r.itemId);
    if (!item || item.type !== 'article') continue;
    const mod = learnFindModuleForItem(item.id);
    const course = mod && learnFindCourseForModule(mod.id);
    if (!mod || !course) continue;
    events.push({
      courseSlug: course.slug, courseTitle: course.title, courseShortTitle: course.shortTitle,
      itemTitle: item.title, itemShortTitle: item.shortTitle, date: r.lastVisitedAt,
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
      const item = db.items.find(it => it.id === r.itemId);
      const mod = item && learnFindModuleForItem(item.id);
      const course = mod && learnFindCourseForModule(mod.id);
      if (!item || !mod || !course) return null;
      return {
        courseSlug: course.slug, courseTitle: course.title, courseShortTitle: course.shortTitle,
        itemTitle: item.title, itemShortTitle: item.shortTitle,
        score: r.score, total: r.total, pct: r.pct, date: r.date,
      };
    })
    .filter(Boolean);
}
