/* UserQuizAttempt: one completed run of a quiz (score/answers/pct). */
class UserQuizAttemptDao extends Dao {
  constructor() { super('userQuizAttempts'); }
}

class UserQuizAttemptRepository extends Repository {
  constructor() { super(new UserQuizAttemptDao()); }

  record(userId, quizId, result) {
    return this.insert({
      id: learnUuid(),
      userId,
      quizId,
      date: new Date().toISOString(),
      answers: result.answers,
      score: result.score,
      total: result.total,
      pct: result.pct,
    });
  }

  forQuiz(userId, quizId) {
    return this.where(r => r.userId === userId && r.quizId === quizId);
  }

  best(attempts) {
    if (!attempts.length) return null;
    return attempts.reduce((best, a) => (!best || a.pct > best.pct ? a : best), null);
  }

  // Recent quiz results, for the homepage's "Ostatnie wyniki" list.
  recentResults(userId, limit) {
    return this.where(r => r.userId === userId)
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, limit || 6)
      .map(r => {
        const quiz = quizRepository.find(r.quizId);
        const mod = quiz && quizRepository.getModule(quiz.id);
        const course = mod && moduleRepository.getCourse(mod.id);
        if (!quiz || !mod || !course) return null;
        return {
          courseSlug: course.slug, courseTitle: course.title, courseShortTitle: course.shortTitle,
          itemTitle: quiz.title, itemShortTitle: quiz.shortTitle,
          score: r.score, total: r.total, pct: r.pct, date: r.date,
        };
      })
      .filter(Boolean);
  }
}

const userQuizAttemptRepository = new UserQuizAttemptRepository();
