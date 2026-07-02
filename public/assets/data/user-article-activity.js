/* UserArticleActivity: per-user visit ("read") tracking for an article. */
class UserArticleActivityDao extends Dao {
  constructor() { super('userArticleActivities'); }
}

class UserArticleActivityRepository extends Repository {
  constructor() { super(new UserArticleActivityDao()); }

  touch(userId, articleId) {
    const now = new Date().toISOString();
    return this.upsert(
      r => r.userId === userId && r.articleId === articleId,
      () => ({ id: learnUuid(), userId, articleId, firstVisitedAt: now, lastVisitedAt: now }),
      { lastVisitedAt: now }
    );
  }

  hasVisited(userId, articleId) {
    return this.count(r => r.userId === userId && r.articleId === articleId) > 0;
  }

  // Recently read articles, for the homepage's "Ostatnie moduły" list.
  recentArticles(userId, limit) {
    const rows = this.where(r => r.userId === userId).slice().sort((a, b) => new Date(b.lastVisitedAt) - new Date(a.lastVisitedAt));
    const events = [];
    for (const r of rows) {
      const article = articleRepository.find(r.articleId);
      if (!article) continue;
      const mod = articleRepository.getModule(article.id);
      const course = mod && moduleRepository.getCourse(mod.id);
      if (!mod || !course) continue;
      events.push({
        courseSlug: course.slug, courseTitle: course.title, courseShortTitle: course.shortTitle,
        itemTitle: article.title, itemShortTitle: article.shortTitle, date: r.lastVisitedAt,
      });
      if (events.length >= (limit || 6)) break;
    }
    return events;
  }
}

const userArticleActivityRepository = new UserArticleActivityRepository();
