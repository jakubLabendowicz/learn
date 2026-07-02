/* Question: an individual quiz question belonging to a question set
 * (question.questionSetId), carrying its own options ({id, text,
 * correct}) — correctness lives on the option, not a separate answer[]. */
class QuestionDao extends Dao {
  constructor() { super('questions'); }
  forQuestionSet(questionSetId) { return this.where(q => q.questionSetId === questionSetId); }
}

class QuestionRepository extends Repository {
  constructor() { super(new QuestionDao()); }

  forQuestionSet(questionSetId) { return this.dao.forQuestionSet(questionSetId); }

  correctOptionIds(question) {
    return question.options.filter(o => o.correct).map(o => o.id);
  }

  // A question's options carry no fixed "key" — the display letter (A, B,
  // C…) is derived from the option's position in its own (stable, stored)
  // options array, so the same option always shows the same letter
  // regardless of any on-screen shuffle.
  optionLabel(question, optionId) {
    const idx = question.options.findIndex(o => o.id === optionId);
    return String.fromCharCode(65 + Math.max(idx, 0));
  }
}

const questionRepository = new QuestionRepository();
