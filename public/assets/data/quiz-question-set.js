/* QuizQuestionSet: join table linking a quiz to the question set(s) it
 * draws from, each with a sampling weight. A quiz with exactly one entry
 * is an ordinary module quiz; several entries make it behave like the
 * former "exam" concept (weighted pooling across sets). */
class QuizQuestionSetDao extends Dao {
  constructor() { super('quizQuestionSets'); }
  forQuiz(quizId) { return this.where(r => r.quizId === quizId); }
  forQuestionSet(questionSetId) { return this.where(r => r.questionSetId === questionSetId); }
}

class QuizQuestionSetRepository extends Repository {
  constructor() { super(new QuizQuestionSetDao()); }

  forQuiz(quizId) { return this.dao.forQuiz(quizId); }
  forQuestionSet(questionSetId) { return this.dao.forQuestionSet(questionSetId); }
}

const quizQuestionSetRepository = new QuizQuestionSetRepository();
