/* Shared localStorage state: active courses, progress, quiz results, read articles. */
const LEARN_STATE_KEY = 'learn:state:v1';

function learnLoadState() {
  try {
    const raw = localStorage.getItem(LEARN_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.courses) return parsed;
    }
  } catch (e) {}
  return { courses: {} };
}

function learnSaveState(state) {
  localStorage.setItem(LEARN_STATE_KEY, JSON.stringify(state));
}

function learnTouchCourse(state, course) {
  const existing = state.courses[course.id];
  const now = new Date().toISOString();
  state.courses[course.id] = Object.assign(
    {
      id: course.id,
      slug: course.slug,
      title: course.title,
      shortTitle: course.shortTitle,
      icon: course.icon,
      accent: course.accent,
      firstVisitedAt: now,
      articlesRead: {},
      quizAttempts: [],
      totalArticles: 0,
      totalQuizzes: 0,
    },
    existing,
    {
      slug: course.slug,
      title: course.title,
      shortTitle: course.shortTitle,
      icon: course.icon,
      accent: course.accent,
      lastVisitedAt: now,
      totalArticles: course.totalArticles,
      totalQuizzes: course.totalQuizzes,
    }
  );
  if (!state.courses[course.id].articlesRead) state.courses[course.id].articlesRead = {};
  if (!state.courses[course.id].quizAttempts) state.courses[course.id].quizAttempts = [];
  return state.courses[course.id];
}

function learnMarkArticleRead(course, module, item) {
  const state = learnLoadState();
  const entry = learnTouchCourse(state, course);
  entry.articlesRead[item.id] = {
    moduleId: module.id,
    moduleTitle: module.title,
    itemTitle: item.title,
    itemShortTitle: item.shortTitle,
    date: new Date().toISOString(),
  };
  learnSaveState(state);
  return state;
}

function learnRecordQuizAttempt(course, module, item, result) {
  const state = learnLoadState();
  const entry = learnTouchCourse(state, course);
  entry.quizAttempts.unshift({
    itemId: item.id,
    moduleId: module.id,
    moduleTitle: module.title,
    itemTitle: item.title,
    itemShortTitle: item.shortTitle,
    score: result.score,
    total: result.total,
    pct: result.pct,
    date: new Date().toISOString(),
  });
  entry.quizAttempts = entry.quizAttempts.slice(0, 50);
  learnSaveState(state);
  return state;
}

function learnCourseProgress(entry) {
  if (!entry || !entry.totalArticles) return 0;
  const totalItems = entry.totalArticles + entry.totalQuizzes;
  if (!totalItems) return 0;
  const readCount = Object.keys(entry.articlesRead || {}).length;
  const quizzedModuleIds = new Set();
  (entry.quizAttempts || []).forEach(a => quizzedModuleIds.add(a.moduleId));
  const doneCount = readCount + quizzedModuleIds.size;
  return Math.min(100, Math.round((doneCount / totalItems) * 100));
}

function learnRecentCourses(state, limit) {
  return Object.values(state.courses)
    .sort((a, b) => new Date(b.lastVisitedAt) - new Date(a.lastVisitedAt))
    .slice(0, limit || 5);
}

function learnRecentModules(state, limit) {
  const events = [];
  Object.values(state.courses).forEach(c => {
    Object.entries(c.articlesRead || {}).forEach(([itemId, a]) => {
      events.push({
        courseId: c.id,
        courseTitle: c.title,
        courseShortTitle: c.shortTitle,
        courseSlug: c.slug,
        moduleId: a.moduleId,
        moduleTitle: a.moduleTitle,
        itemTitle: a.itemTitle,
        itemShortTitle: a.itemShortTitle,
        date: a.date,
      });
    });
  });
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events.slice(0, limit || 6);
}

function learnRecentResults(state, limit) {
  const events = [];
  Object.values(state.courses).forEach(c => {
    (c.quizAttempts || []).forEach(a => {
      events.push(Object.assign({ courseId: c.id, courseTitle: c.title, courseShortTitle: c.shortTitle, courseSlug: c.slug }, a));
    });
  });
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events.slice(0, limit || 6);
}
