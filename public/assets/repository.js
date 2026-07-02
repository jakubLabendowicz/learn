/* Base Repository: wraps a Dao and re-exposes its plain CRUD; every
 * entity-specific Repository (see /assets/data/*.js) extends this,
 * adding domain logic — finders, cross-entity joins, computed views,
 * validation — on top of its Dao's single-table access. Repository is
 * the ONLY layer the rest of the app (pages, the course.js router)
 * should call into; nothing outside dao.js/repository.js and
 * /assets/data should reference a Dao or storage.js directly. */
class Repository {
  constructor(dao) { this.dao = dao; }

  all() { return this.dao.all(); }
  where(pred) { return this.dao.where(pred); }
  first(pred) { return this.dao.first(pred); }
  find(id) { return this.dao.find(id); }
  count(pred) { return this.dao.count(pred); }
  insert(row) { return this.dao.insert(row); }
  insertMany(rows) { return this.dao.insertMany(rows); }
  update(id, patch) { return this.dao.update(id, patch); }
  updateWhere(pred, patch) { return this.dao.updateWhere(pred, patch); }
  upsert(pred, build, patch) { return this.dao.upsert(pred, build, patch); }
  remove(id) { return this.dao.remove(id); }
  removeWhere(pred) { return this.dao.removeWhere(pred); }
}
