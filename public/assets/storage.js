/* Local storage engine for the "learn" app. This is the ONLY file that
 * touches the `localStorage` global directly — every other script reads
 * and writes app data exclusively through the `LearnDB` ORM defined here
 * (or, for bulk/multi-table operations, through learnLoadDB/learnSaveDB).
 *
 * The whole app lives in a single localStorage key holding one JSON blob
 * with named arrays ("tables"), each row carrying its own UUID `id` and
 * relating to other rows via foreign-key fields (see imported-courses.js
 * for the table relationships). `LearnDB.<table>` exposes active-record
 * style CRUD (find/where/insert/update/upsert/remove…) per table, so
 * call sites don't need to manually load/mutate/save the whole blob for
 * simple single-table operations. */
const LEARN_DB_KEY = 'learn:db:v1';
const LEARN_SEEDED_KEY = 'learn:seeded-builtin:v1';
const LEARN_DB_TABLES = [
  'courses', 'questionSets', 'questions', 'modules', 'articles', 'quizes', 'quizQuestionSets',
  'users',
  'userCourseActivities', 'userModuleActivities', 'userArticleActivities', 'userQuizActivities', 'userQuizAttempts',
];
const LEARN_DB_DEFAULTS = LEARN_DB_TABLES.reduce((acc, name) => { acc[name] = []; return acc; }, {});

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

function learnIsSeeded() { return !!localStorage.getItem(LEARN_SEEDED_KEY); }
function learnMarkSeeded() { localStorage.setItem(LEARN_SEEDED_KEY, '1'); }

/* ---------------- ORM ---------------- */

class LearnTable {
  constructor(name) { this.name = name; }

  all() { return learnLoadDB()[this.name]; }
  where(pred) { return this.all().filter(pred); }
  first(pred) { return this.all().find(pred) || null; }
  find(id) { return this.first(r => r.id === id); }
  count(pred) { return pred ? this.where(pred).length : this.all().length; }

  insert(row) {
    const db = learnLoadDB();
    db[this.name].push(row);
    learnSaveDB(db);
    return row;
  }

  insertMany(rows) {
    const db = learnLoadDB();
    db[this.name].push(...rows);
    learnSaveDB(db);
    return rows;
  }

  update(id, patch) {
    const db = learnLoadDB();
    const row = db[this.name].find(r => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    learnSaveDB(db);
    return row;
  }

  updateWhere(pred, patch) {
    const db = learnLoadDB();
    const row = db[this.name].find(pred);
    if (!row) return null;
    Object.assign(row, patch);
    learnSaveDB(db);
    return row;
  }

  // Finds the first row matching `pred`; if found, merges `patch` into it,
  // otherwise inserts a freshly built row (via `build()`). Used for
  // "touch" (visit-tracking) tables, which are find-or-create-then-update.
  upsert(pred, build, patch) {
    const db = learnLoadDB();
    let row = db[this.name].find(pred);
    if (row) Object.assign(row, patch);
    else { row = build(); db[this.name].push(row); }
    learnSaveDB(db);
    return row;
  }

  remove(id) {
    const db = learnLoadDB();
    const before = db[this.name].length;
    db[this.name] = db[this.name].filter(r => r.id !== id);
    learnSaveDB(db);
    return db[this.name].length < before;
  }

  removeWhere(pred) {
    const db = learnLoadDB();
    db[this.name] = db[this.name].filter(r => !pred(r));
    learnSaveDB(db);
  }
}

const LearnDB = LEARN_DB_TABLES.reduce((acc, name) => { acc[name] = new LearnTable(name); return acc; }, {});
