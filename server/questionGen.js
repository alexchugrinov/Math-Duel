function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateEasy() {
  const ops = ['+', '-', '×'];
  const op = ops[randInt(0, 2)];
  let a, b, answer, text;

  if (op === '+') {
    a = randInt(1, 20); b = randInt(1, 20);
    answer = a + b;
    text = `${a} + ${b} = ?`;
  } else if (op === '-') {
    a = randInt(2, 20); b = randInt(1, a);
    answer = a - b;
    text = `${a} - ${b} = ?`;
  } else {
    a = randInt(1, 12); b = randInt(1, 12);
    answer = a * b;
    text = `${a} × ${b} = ?`;
  }
  return { text, answer, timeLimitMs: 10000 };
}

function generateMedium() {
  const type = randInt(0, 3);

  if (type === 0) {
    // a op b op c
    const ops = ['+', '-'];
    const op1 = ops[randInt(0, 1)];
    const op2 = ops[randInt(0, 1)];
    const a = randInt(5, 50), b = randInt(5, 50), c = randInt(1, 30);
    const mid = op1 === '+' ? a + b : a - b;
    const answer = op2 === '+' ? mid + c : mid - c;
    return { text: `${a} ${op1} ${b} ${op2} ${c} = ?`, answer, timeLimitMs: 12000 };
  }

  if (type === 1) {
    // a × b + c or a × b - c
    const a = randInt(2, 12), b = randInt(2, 12), c = randInt(1, 30);
    const op = randInt(0, 1) === 0 ? '+' : '-';
    const answer = op === '+' ? a * b + c : a * b - c;
    return { text: `${a} × ${b} ${op} ${c} = ?`, answer, timeLimitMs: 12000 };
  }

  if (type === 2) {
    // a ÷ b (whole number)
    const b = randInt(2, 10), answer = randInt(2, 12);
    const a = b * answer;
    return { text: `${a} ÷ ${b} = ?`, answer, timeLimitMs: 12000 };
  }

  // a ÷ b + c
  const b = randInt(2, 8), q = randInt(2, 10), c = randInt(1, 20);
  const a = b * q;
  const op = randInt(0, 1) === 0 ? '+' : '-';
  const answer = op === '+' ? q + c : q - c;
  return { text: `${a} ÷ ${b} ${op} ${c} = ?`, answer, timeLimitMs: 12000 };
}

function generateHard() {
  const type = randInt(0, 2);

  if (type === 0) {
    // larger numbers two-op
    const a = randInt(10, 100), b = randInt(5, 50), c = randInt(5, 40);
    const op1 = randInt(0, 1) === 0 ? '+' : '-';
    const op2 = randInt(0, 1) === 0 ? '+' : '-';
    const mid = op1 === '+' ? a + b : a - b;
    const answer = op2 === '+' ? mid + c : mid - c;
    return { text: `${a} ${op1} ${b} ${op2} ${c} = ?`, answer, timeLimitMs: 15000 };
  }

  if (type === 1) {
    // ? × b = a  (find the unknown)
    const answer = randInt(2, 20), b = randInt(2, 12);
    const a = answer * b;
    return { text: `? × ${b} = ${a}`, answer, timeLimitMs: 15000 };
  }

  // x + b = a  or  x - b = a  (find x)
  const b = randInt(5, 50), answer = randInt(5, 80);
  const op = randInt(0, 1) === 0 ? '+' : '-';
  const a = op === '+' ? answer + b : answer - b;
  const sign = op === '+' ? '+' : '-';
  return { text: `x ${sign} ${b} = ${a}, x = ?`, answer, timeLimitMs: 15000 };
}

function generateQuestion(difficulty) {
  let q;
  if (difficulty === 'easy') q = generateEasy();
  else if (difficulty === 'hard') q = generateHard();
  else q = generateMedium();

  return {
    questionId: crypto.randomUUID(),
    text: q.text,
    answer: q.answer,
    timeLimitMs: q.timeLimitMs,
  };
}

function generateSet(difficulty, count = 10) {
  return Array.from({ length: count }, () => generateQuestion(difficulty));
}

module.exports = { generateQuestion, generateSet };
