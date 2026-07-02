/* QuestionSet: a course-scoped pool of questions (questionSet.courseId),
 * referenced by one or more quizzes via quizQuestionSets. */
class QuestionSetDao extends Dao {
  constructor() { super('questionSets'); }
  forCourse(courseId) { return this.where(qs => qs.courseId === courseId); }
}

class QuestionSetRepository extends Repository {
  constructor() { super(new QuestionSetDao()); }

  forCourse(courseId) { return this.dao.forCourse(courseId); }
}

const questionSetRepository = new QuestionSetRepository();
