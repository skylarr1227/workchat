process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('assert');
const {
  initDatabase,
  createUser,
  addAnimalToUser,
  getUserById,
  getUserAnimals,
  performSell
} = require('../server');

const dog = {
  name: '🐶 Dog',
  emoji: '🐶',
  rarity: 'common',
  level: 1,
  str: 8,
  mag: 4,
  pr: 6,
  mr: 5,
  hp: 25,
  wp: 10
};

test('performSell sells animals via command', async () => {
  await initDatabase();
  const userId = await createUser('tester', 'pass');
  await addAnimalToUser(userId, dog);
  await addAnimalToUser(userId, dog);
  const result = await performSell(userId, '🐶 Dog', 2);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.newCowoncy, 106);
  const remaining = await getUserAnimals(userId);
  assert.strictEqual(remaining.length, 0);
});
