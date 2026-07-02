/* UserQuizActivity: per-user visit tracking for a quiz (distinct from
 * userQuizAttempts, which records actual completed attempts/scores). */
class UserQuizActivityDao extends Dao {
  constructor() { super('userQuizActivities'); }
}

class UserQuizActivityRepository extends Repository {
  constructor() { super(new UserQuizActivityDao()); }

  touch(userId, quizId) {
    const now = new Date().toISOString();
    return this.upsert(
      r => r.userId === userId && r.quizId === quizId,
      () => ({ id: learnUuid(), userId, quizId, firstVisitedAt: now, lastVisitedAt: now }),
      { lastVisitedAt: now }
    );
  }
}

const userQuizActivityRepository = new UserQuizActivityRepository();
