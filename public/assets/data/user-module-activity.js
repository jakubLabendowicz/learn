/* UserModuleActivity: per-user visit tracking for a module
 * (first/lastVisitedAt). */
class UserModuleActivityDao extends Dao {
  constructor() { super('userModuleActivities'); }
}

class UserModuleActivityRepository extends Repository {
  constructor() { super(new UserModuleActivityDao()); }

  touch(userId, moduleId) {
    const now = new Date().toISOString();
    return this.upsert(
      r => r.userId === userId && r.moduleId === moduleId,
      () => ({ id: learnUuid(), userId, moduleId, firstVisitedAt: now, lastVisitedAt: now }),
      { lastVisitedAt: now }
    );
  }
}

const userModuleActivityRepository = new UserModuleActivityRepository();
