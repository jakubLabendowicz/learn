/* Article: a course module's reading content (article.moduleId), served
 * at /courses/{course}/modules/{module}/articles/{slug}. */
class ArticleDao extends Dao {
  constructor() { super('articles'); }
  forModule(moduleId) { return this.where(a => a.moduleId === moduleId); }
  bySlug(moduleId, slug) { return this.first(a => a.moduleId === moduleId && a.slug === slug); }
}

class ArticleRepository extends Repository {
  constructor() { super(new ArticleDao()); }

  forModule(moduleId) { return this.dao.forModule(moduleId); }
  bySlug(moduleId, slug) { return this.dao.bySlug(moduleId, slug); }

  getModule(articleId) {
    const article = this.dao.find(articleId);
    return article ? moduleRepository.find(article.moduleId) : null;
  }
}

const articleRepository = new ArticleRepository();
