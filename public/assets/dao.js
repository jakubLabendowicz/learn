/* Base DAO: generic per-table CRUD built directly on storage.js's raw
 * localStorage connection (learnLoadDB/learnSaveDB). Every entity-specific
 * Dao (see /assets/data/*.js) extends this with table name + finder
 * methods. Dao is the only layer that calls learnLoadDB/learnSaveDB —
 * everything above it (Repository and up) goes through a Dao instance. */
class Dao {
  constructor(tableName) { this.tableName = tableName; }

  all() { return learnLoadDB()[this.tableName]; }
  where(pred) { return this.all().filter(pred); }
  first(pred) { return this.all().find(pred) || null; }
  find(id) { return this.first(r => r.id === id); }
  count(pred) { return pred ? this.where(pred).length : this.all().length; }

  insert(row) {
    const db = learnLoadDB();
    db[this.tableName].push(row);
    learnSaveDB(db);
    return row;
  }

  insertMany(rows) {
    const db = learnLoadDB();
    db[this.tableName].push(...rows);
    learnSaveDB(db);
    return rows;
  }

  update(id, patch) {
    const db = learnLoadDB();
    const row = db[this.tableName].find(r => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    learnSaveDB(db);
    return row;
  }

  updateWhere(pred, patch) {
    const db = learnLoadDB();
    const row = db[this.tableName].find(pred);
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
    let row = db[this.tableName].find(pred);
    if (row) Object.assign(row, patch);
    else { row = build(); db[this.tableName].push(row); }
    learnSaveDB(db);
    return row;
  }

  remove(id) {
    const db = learnLoadDB();
    const before = db[this.tableName].length;
    db[this.tableName] = db[this.tableName].filter(r => r.id !== id);
    learnSaveDB(db);
    return db[this.tableName].length < before;
  }

  removeWhere(pred) {
    const db = learnLoadDB();
    db[this.tableName] = db[this.tableName].filter(r => !pred(r));
    learnSaveDB(db);
  }
}
