/* UserCourseActivity: per-user visit tracking for a course
 * (first/lastVisitedAt) plus an optional per-user accent override. */
class UserCourseActivityDao extends Dao {
  constructor() { super('userCourseActivities'); }
  forUserAndCourse(userId, courseId) { return this.first(r => r.userId === userId && r.courseId === courseId); }
}

class UserCourseActivityRepository extends Repository {
  constructor() { super(new UserCourseActivityDao()); }

  forUserAndCourse(userId, courseId) { return this.dao.forUserAndCourse(userId, courseId); }

  touch(userId, courseId) {
    const now = new Date().toISOString();
    return this.upsert(
      r => r.userId === userId && r.courseId === courseId,
      () => ({ id: learnUuid(), userId, courseId, firstVisitedAt: now, lastVisitedAt: now, customAccent: null }),
      { lastVisitedAt: now }
    );
  }

  setCustomAccent(userId, courseId, accent) {
    const row = this.touch(userId, courseId);
    return this.update(row.id, { customAccent: accent || null });
  }

  // Homepage/course-grid: courses the user has visited, most recent
  // first, with resolved course fields + live progress.
  recentCourses(userId, limit) {
    return this.where(r => r.userId === userId)
      .slice()
      .sort((a, b) => new Date(b.lastVisitedAt) - new Date(a.lastVisitedAt))
      .slice(0, limit || 5)
      .map(r => {
        const course = courseRepository.find(r.courseId);
        if (!course) return null;
        return {
          id: course.id,
          slug: course.slug,
          title: course.title,
          shortTitle: course.shortTitle,
          icon: course.icon,
          accent: r.customAccent || course.accent,
          firstVisitedAt: r.firstVisitedAt,
          lastVisitedAt: r.lastVisitedAt,
          pct: courseRepository.getProgress(userId, course.id),
        };
      })
      .filter(Boolean);
  }
}

const userCourseActivityRepository = new UserCourseActivityRepository();
