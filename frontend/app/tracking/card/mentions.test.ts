import { describe, expect, it } from 'vitest';
import { insertMention, mentionQuery } from './mentions';

describe('insertMention', () => {
  it('inserts token at caret', () => {
    expect(insertMention('hello world', 5, 3)).toEqual({ text: 'hello@[3] world', caret: 10 });
  });
  it('replaces the @query typed before the caret', () => {
    expect(insertMention('hi @so there', 6, 3)).toEqual({ text: 'hi @[3] there', caret: 8 });
  });
  it('adds no extra space when one follows', () => {
    expect(insertMention('@ x', 1, 7)).toEqual({ text: '@[7] x', caret: 5 });
  });
});

describe('mentionQuery', () => {
  it('finds the partial after @ at word start', () => {
    expect(mentionQuery('hi @so', 6)).toEqual({ start: 3, query: 'so' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  });
  it('ignores @ inside a word, a finished token or after a space', () => {
    expect(mentionQuery('a@b', 3)).toBeNull();
    expect(mentionQuery('@[3]', 4)).toBeNull();
    expect(mentionQuery('@so x', 5)).toBeNull();
  });
});
