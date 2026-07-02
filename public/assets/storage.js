/* Storage layer for the "learn" app. This is the ONLY file that touches
 * the `localStorage` global directly — every other script reads and
 * writes app data exclusively through a Dao (dao.js), which in turn goes
 * through the primitives defined here.
 *
 * The whole app lives in a single localStorage key holding one JSON blob
 * with named arrays ("tables"), each row carrying its own UUID `id` and
 * relating to other rows via foreign-key fields (see /assets/data/*.js
 * for the table relationships and domain logic). */
const LEARN_DB_KEY = 'learn:db:v1';
const LEARN_SEEDED_KEY = 'learn:seeded-builtin:v1';
const LEARN_DB_TABLES = [
  'courses', 'questionSets', 'questions', 'modules', 'articles', 'quizes', 'quizQuestionSets',
  'users',
  'userCourseActivities', 'userModuleActivities', 'userArticleActivities', 'userQuizActivities', 'userQuizAttempts',
];
const LEARN_DB_DEFAULTS = LEARN_DB_TABLES.reduce((acc, name) => { acc[name] = []; return acc; }, {});

const LEARN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function learnUuid() { return crypto.randomUUID(); }
function learnIsUuid(s) { return typeof s === 'string' && LEARN_UUID_RE.test(s); }

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

function learnIsSeeded() { return !!localStorage.getItem(LEARN_SEEDED_KEY); }
function learnMarkSeeded() { localStorage.setItem(LEARN_SEEDED_KEY, '1'); }
