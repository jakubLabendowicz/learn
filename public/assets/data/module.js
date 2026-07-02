/* Module: a course's module (module.courseId), containing articles and
 * quizzes (linked back to it via their own moduleId). */
class ModuleDao extends Dao {
  constructor() { super('modules'); }
  forCourse(courseId) { return this.where(m => m.courseId === courseId); }
  bySlug(courseId, slug) { return this.first(m => m.courseId === courseId && m.slug === slug); }
}

class ModuleRepository extends Repository {
  constructor() { super(new ModuleDao()); }

  forCourse(courseId) { return this.dao.forCourse(courseId); }
  bySlug(courseId, slug) { return this.dao.bySlug(courseId, slug); }

  getCourse(moduleId) {
    const mod = this.dao.find(moduleId);
    return mod ? courseRepository.find(mod.courseId) : null;
  }

  // A module with its articles and quizzes resolved into full objects
  // (each quiz further carrying its resolved question pool) — the shape
  // the course engine renders directly.
  withItems(mod) {
    const articles = articleRepository.forModule(mod.id);
    const quizzes = quizRepository.forModule(mod.id).map(q => quizRepository.withQuestionPool(q));
    return Object.assign({}, mod, { articles, quizzes });
  }
}

const moduleRepository = new ModuleRepository();
