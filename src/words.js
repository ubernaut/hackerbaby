// Words a 17-month-old is likely to know, several per letter so the
// prompts stay fresh.
export const LETTER_WORDS = {
  A: ['apple', 'airplane', 'ant', 'arm'],
  B: ['ball', 'banana', 'bubble', 'book', 'bird', 'bath'],
  C: ['cat', 'car', 'cookie', 'cup', 'cow'],
  D: ['dada', 'dog', 'duck', 'dance'],
  E: ['egg', 'elephant', 'ear', 'eyes'],
  F: ['fish', 'flower', 'foot', 'frog'],
  G: ['go', 'grapes', 'giraffe', 'green'],
  H: ['hat', 'hug', 'horse', 'hand'],
  I: ['ice', 'iguana', 'insect'],
  J: ['jump', 'juice', 'jam', 'jacket'],
  K: ['kiss', 'kick', 'kitty', 'key'],
  L: ['light', 'lion', 'leaf', 'love'],
  M: ['mama', 'milk', 'moon', 'monkey'],
  N: ['nose', 'night', 'nest', 'noodle'],
  O: ['open', 'orange', 'owl', 'octopus'],
  P: ['puppy', 'peekaboo', 'pop', 'pig'],
  Q: ['quack', 'quiet', 'queen'],
  R: ['run', 'rain', 'rock', 'red'],
  S: ['star', 'sun', 'shoe', 'sock', 'splash'],
  T: ['tree', 'truck', 'toes', 'tickle'],
  U: ['up', 'umbrella', 'uh-oh'],
  V: ['vroom', 'van', 'violin'],
  W: ['water', 'wave', 'woof', 'wow'],
  X: ['xylophone', 'fox', 'box'],
  Y: ['yes', 'yay', 'yellow', 'yum'],
  Z: ['zoo', 'zebra', 'zoom']
};

export const LETTERS = Object.keys(LETTER_WORDS);

export function randomWordFor(letter) {
  const words = LETTER_WORDS[letter] || [];
  return words[Math.floor(Math.random() * words.length)] || letter;
}

// Built-in picture cards for the "say it" game, seeded from the same
// baby vocabulary. `alt` lists extra utterances that count as correct.
export const BUILTIN_CARDS = [
  { word: 'dog', emoji: '🐶', alt: ['puppy', 'doggy', 'woof', 'woof woof'] },
  { word: 'cat', emoji: '🐱', alt: ['kitty', 'meow', 'kitty cat'] },
  { word: 'ball', emoji: '⚽', alt: ['balls'] },
  { word: 'banana', emoji: '🍌', alt: ['nana'] },
  { word: 'apple', emoji: '🍎', alt: [] },
  { word: 'duck', emoji: '🦆', alt: ['quack', 'ducky'] },
  { word: 'car', emoji: '🚗', alt: ['vroom', 'beep beep'] },
  { word: 'book', emoji: '📖', alt: [] },
  { word: 'star', emoji: '⭐', alt: ['stars'] },
  { word: 'moon', emoji: '🌙', alt: [] },
  { word: 'sun', emoji: '☀️', alt: ['sunny'] },
  { word: 'fish', emoji: '🐟', alt: ['fishy'] },
  { word: 'bird', emoji: '🐦', alt: ['birdie', 'tweet'] },
  { word: 'bear', emoji: '🧸', alt: ['teddy', 'teddy bear'] },
  { word: 'shoe', emoji: '👟', alt: ['shoes'] },
  { word: 'milk', emoji: '🥛', alt: ['bottle'] },
  { word: 'tree', emoji: '🌳', alt: [] },
  { word: 'flower', emoji: '🌸', alt: ['flowers'] },
  { word: 'frog', emoji: '🐸', alt: ['ribbit'] },
  { word: 'elephant', emoji: '🐘', alt: [] },
  { word: 'cow', emoji: '🐮', alt: ['moo'] },
  { word: 'baby', emoji: '👶', alt: [] }
];
