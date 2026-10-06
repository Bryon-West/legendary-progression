import assert from 'node:assert/strict';
import test from 'node:test';
import { profileInitials } from './profile-initials.ts';

test('profile initials use first and last names', () => {
  assert.equal(profileInitials('Bryon West'), 'BW');
  assert.equal(profileInitials('Bryon J West'), 'BW');
});

test('profile initials handle single-word, renamed, and missing names', () => {
  assert.equal(profileInitials('Legendary'), 'L');
  assert.equal(profileInitials('  Kai  '), 'K');
  assert.equal(profileInitials('   '), '?');
  assert.equal(profileInitials(undefined), '?');
  assert.equal(profileInitials(null), '?');
});
