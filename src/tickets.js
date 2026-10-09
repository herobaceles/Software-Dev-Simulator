// Each ticket is a small task the player solves by writing real Python.
// `fn` is the function the tests call; `tests` are [args] -> expected value (JSON, converted to Python).
export const tickets = [
  {
    id: 'COZY-101', title: 'Fix off-by-one in pagination', xp: 40, fn: 'paginate',
    desc: 'Users report the last row of every page is missing. paginate(items, page, size) should return the rows for a 1-based page number.',
    starter: `# The last row of each page keeps disappearing. Find the bug!
def paginate(items, page, size):
    start = (page - 1) * size
    end = start + size - 1
    return items[start:end]
`,
    tests: [
      { args: [[1, 2, 3, 4, 5], 1, 2], expect: [1, 2] },
      { args: [[1, 2, 3, 4, 5], 2, 2], expect: [3, 4] },
      { args: [[1, 2, 3, 4, 5], 3, 2], expect: [5] },
      { args: [[], 1, 10], expect: [] },
    ],
  },
  {
    id: 'COZY-102', title: 'Palindrome check for usernames', xp: 50, fn: 'is_palindrome',
    desc: 'Return True when the text reads the same forwards and backwards. Ignore case, spaces and punctuation.',
    starter: `def is_palindrome(text):
    # your code here
    pass
`,
    tests: [
      { args: ['level'], expect: true },
      { args: ['Cozy'], expect: false },
      { args: ['A man, a plan, a canal: Panama'], expect: true },
      { args: [''], expect: true },
    ],
  },
  {
    id: 'COZY-103', title: 'FizzBuzz for the onboarding quiz', xp: 50, fn: 'fizz_buzz',
    desc: 'Return a list for 1..n. Multiples of 3 become "Fizz", multiples of 5 become "Buzz", multiples of both become "FizzBuzz". Everything else stays a number.',
    starter: `def fizz_buzz(n):
    # your code here
    pass
`,
    tests: [
      { args: [5], expect: [1, 2, 'Fizz', 4, 'Buzz'] },
      { args: [15], expect: [1, 2, 'Fizz', 4, 'Buzz', 'Fizz', 7, 8, 'Fizz', 'Buzz', 11, 'Fizz', 13, 14, 'FizzBuzz'] },
      { args: [0], expect: [] },
    ],
  },
  {
    id: 'COZY-104', title: 'Split uploads into batches', xp: 60, fn: 'chunk',
    desc: 'chunk(items, size) splits a list into lists of at most `size` items, keeping the order.',
    starter: `def chunk(items, size):
    # your code here
    pass
`,
    tests: [
      { args: [[1, 2, 3, 4, 5], 2], expect: [[1, 2], [3, 4], [5]] },
      { args: [['a', 'b', 'c'], 3], expect: [['a', 'b', 'c']] },
      { args: [[], 4], expect: [] },
    ],
  },
  {
    id: 'COZY-105', title: 'Word count for the blog editor', xp: 65, fn: 'count_words',
    desc: 'Return a dict mapping each word to how many times it appears. Lowercase everything and ignore punctuation.',
    starter: `def count_words(text):
    # your code here
    pass
`,
    tests: [
      { args: ['the cat and the hat'], expect: { the: 2, cat: 1, and: 1, hat: 1 } },
      { args: ['Tea, tea... TEA!'], expect: { tea: 3 } },
      { args: [''], expect: {} },
    ],
  },
  {
    id: 'COZY-106', title: 'Flatten nested menu items', xp: 70, fn: 'flatten',
    desc: 'Turn an arbitrarily nested list into a flat one, keeping the order.',
    starter: `def flatten(items):
    # your code here
    pass
`,
    tests: [
      { args: [[1, [2, 3], [4, [5, [6]]]]], expect: [1, 2, 3, 4, 5, 6] },
      { args: [[[], [[]], 'a']], expect: ['a'] },
      { args: [[]], expect: [] },
    ],
  },
  {
    id: 'COZY-107', title: 'Readable build durations', xp: 75, fn: 'format_duration',
    desc: 'Turn a number of seconds into text like "1h 2m 3s". Leave out parts that are zero, but 0 seconds is "0s".',
    starter: `def format_duration(seconds):
    # your code here
    pass
`,
    tests: [
      { args: [3723], expect: '1h 2m 3s' },
      { args: [60], expect: '1m' },
      { args: [3605], expect: '1h 5s' },
      { args: [0], expect: '0s' },
    ],
  },
  {
    id: 'COZY-108', title: 'Group tickets by status', xp: 85, fn: 'group_by',
    desc: 'group_by(items, key) returns a dict whose keys are each item[key] and whose values are lists of the matching items, in order.',
    starter: `def group_by(items, key):
    # your code here
    pass
`,
    tests: [
      {
        args: [[{ id: 1, s: 'open' }, { id: 2, s: 'done' }, { id: 3, s: 'open' }], 's'],
        expect: { open: [{ id: 1, s: 'open' }, { id: 3, s: 'open' }], done: [{ id: 2, s: 'done' }] },
      },
      { args: [[], 's'], expect: {} },
    ],
  },
];

export const ranks = ['Intern', 'Junior Dev', 'Mid-level Dev', 'Senior Dev', 'Staff Engineer', 'Principal Engineer', 'Cozy Wizard'];
