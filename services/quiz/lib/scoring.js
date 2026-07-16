function gradeQuizAttempt(quiz, rawAnswers = {}) {
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  const answers = normalizeSubmittedAnswers(rawAnswers, questions);
  const results = questions.map(question => {
    const studentAnswer = answers[question.id] ?? '';
    const correct = isCorrectAnswer(question, studentAnswer);
    const marks = Number(question.marks || 1);
    return {
      questionId: question.id,
      order: question.orderIndex,
      type: question.type,
      difficulty: question.difficulty,
      conceptTag: question.conceptTag,
      weakAreaLabel: question.weakAreaLabel,
      prompt: question.prompt,
      studentAnswer,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      marks,
      awardedMarks: correct ? marks : 0,
      correct,
    };
  });

  const score = results.reduce((sum, item) => sum + item.awardedMarks, 0);
  const maxScore = results.reduce((sum, item) => sum + item.marks, 0);
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;
  const weakAreas = results
    .filter(item => !item.correct && item.weakAreaLabel)
    .map(item => ({
      label: item.weakAreaLabel,
      conceptTag: item.conceptTag,
      difficulty: item.difficulty,
      questionId: item.questionId,
    }));

  return {
    answers,
    results,
    score,
    maxScore,
    percentage,
    correctCount: results.filter(item => item.correct).length,
    questionCount: results.length,
    weakAreas,
  };
}

function normalizeSubmittedAnswers(rawAnswers, questions = []) {
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return {};
  const questionIds = new Set(questions.map(question => question.id));
  const answers = {};
  for (const [key, value] of Object.entries(rawAnswers)) {
    if (!questionIds.has(key)) continue;
    answers[key] = normalizeAnswerText(value).slice(0, 2000);
  }
  return answers;
}

function isCorrectAnswer(question, answer) {
  const studentAnswer = normalizeComparable(answer);
  const correctAnswer = normalizeComparable(question?.correctAnswer);
  if (!studentAnswer || !correctAnswer) return false;
  if (studentAnswer === correctAnswer) return true;

  if (question?.type === 'short_answer') {
    return isReasonableShortAnswerMatch(studentAnswer, correctAnswer);
  }

  return false;
}

function isReasonableShortAnswerMatch(studentAnswer, correctAnswer) {
  if (studentAnswer.includes(correctAnswer) || correctAnswer.includes(studentAnswer)) {
    return Math.min(studentAnswer.length, correctAnswer.length) >= Math.min(12, correctAnswer.length);
  }

  const studentTokens = meaningfulTokens(studentAnswer);
  const correctTokens = meaningfulTokens(correctAnswer);
  if (correctTokens.length < 3) return false;
  const overlap = correctTokens.filter(token => studentTokens.includes(token)).length;
  return overlap / correctTokens.length >= 0.72;
}

function normalizeAnswerText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

function normalizeComparable(value) {
  return normalizeAnswerText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.%/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulTokens(value) {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'by',
    'for',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'the',
    'to',
    'with',
  ]);
  return normalizeComparable(value)
    .split(' ')
    .filter(token => token.length > 2 && !stopWords.has(token));
}

module.exports = {
  gradeQuizAttempt,
  normalizeSubmittedAnswers,
  isCorrectAnswer,
};
