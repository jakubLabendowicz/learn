/* Quiz: a course module's quiz (quiz.moduleId), served at
 * /courses/{course}/modules/{module}/quizes/{slug}. Its question pool is
 * resolved through quizQuestionSets -> questionSets -> questions; a quiz
 * with several question sets behaves like the former "exam" type
 * (weighted sampling across sets), with no separate type/flag for it. */
class QuizDao extends Dao {
  constructor() { super('quizes'); }
  forModule(moduleId) { return this.where(q => q.moduleId === moduleId); }
  bySlug(moduleId, slug) { return this.first(q => q.moduleId === moduleId && q.slug === slug); }
}

class QuizRepository extends Repository {
  constructor() { super(new QuizDao()); }

  forModule(moduleId) { return this.dao.forModule(moduleId); }
  bySlug(moduleId, slug) { return this.dao.bySlug(moduleId, slug); }

  getModule(quizId) {
    const quiz = this.dao.find(quizId);
    return quiz ? moduleRepository.find(quiz.moduleId) : null;
  }

  // Resolves a quiz's full question pool (in quizQuestionSets order) as
  // { questionSetId, weight, questions } — each set annotated with its
  // sampling weight, for proportional selection.
  getQuestionPool(quizId) {
    return quizQuestionSetRepository.forQuiz(quizId).map(ref => ({
      questionSetId: ref.questionSetId,
      weight: ref.weight,
      questions: questionRepository.forQuestionSet(ref.questionSetId),
    }));
  }

  getAllQuestions(quizId) {
    return this.getQuestionPool(quizId).flatMap(qs => qs.questions);
  }

  withQuestionPool(quiz) {
    return Object.assign({}, quiz, { questionSets: this.getQuestionPool(quiz.id) });
  }
}

const quizRepository = new QuizRepository();
