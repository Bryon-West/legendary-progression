import assert from 'node:assert/strict';
import test from 'node:test';
import { profileInitials } from './profile-initials.ts';

test('profile initials use first and last names', () => {
  assert.equal(profileInitials('Bryon West'), 'BW');
  assert.equal(profileInitials('Bryon J West'), 'BW');
  assert.equal(profileInitials('Bryon', 'Bryon West'), 'BW');
  assert.equal(profileInitials('B', 'Bryon West'), 'BW');
  assert.equal(profileInitials('Bry', 'Bryon West'), 'BW');
});

test('profile initials handle single-word, renamed, and missing names', () => {
  assert.equal(profileInitials('Legendary'), 'L');
  assert.equal(profileInitials('  Kai  '), 'K');
  assert.equal(profileInitials('Casey Rivera', 'Bryon West'), 'CR');
  assert.equal(profileInitials('Athlete', 'Bryon West'), 'BW');
  assert.equal(profileInitials('   '), '?');
  assert.equal(profileInitials(undefined), '?');
  assert.equal(profileInitials(null), '?');
});

test('email initials are only a fallback after profile and display names', () => {
  assert.equal(profileInitials(null, null, 'bryon.west@example.test'), 'BW');
  assert.equal(profileInitials(null, null, 'athlete@example.test'), 'A');
  assert.equal(profileInitials('Kai', null, 'bryon.west@example.test'), 'K');
});
