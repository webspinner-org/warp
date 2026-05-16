import { describe, it, expect } from 'vitest';
import { sanitizeForPb, generateAppId } from './database-applications.js';

describe('sanitizeForPb', () => {
  it('lowercases', () => {
    expect(sanitizeForPb('Transactions')).toBe('transactions');
    expect(sanitizeForPb('BookKeeping')).toBe('bookkeeping');
  });

  it('replaces spaces with underscores', () => {
    expect(sanitizeForPb('Service History')).toBe('service_history');
    expect(sanitizeForPb('Date of Sale')).toBe('date_of_sale');
  });

  it('replaces special characters with underscores', () => {
    expect(sanitizeForPb('Date of Sale!')).toBe('date_of_sale');
    expect(sanitizeForPb('Plant (Species)')).toBe('plant_species');
    expect(sanitizeForPb('A/R Accounts')).toBe('a_r_accounts');
  });

  it('collapses runs of underscores', () => {
    expect(sanitizeForPb('a  b')).toBe('a_b');
    expect(sanitizeForPb('a!@#b')).toBe('a_b');
  });

  it('strips leading and trailing underscores', () => {
    expect(sanitizeForPb('!hello!')).toBe('hello');
    expect(sanitizeForPb('___transactions___')).toBe('transactions');
  });

  it('prepends "x_" to identifiers that would start with a digit', () => {
    expect(sanitizeForPb('123abc')).toBe('x_123abc');
    expect(sanitizeForPb('1day')).toBe('x_1day');
  });

  it('returns "unnamed" for empty/whitespace input', () => {
    expect(sanitizeForPb('')).toBe('unnamed');
    expect(sanitizeForPb('   ')).toBe('unnamed');
    expect(sanitizeForPb('!@#')).toBe('unnamed');
  });

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(100);
    expect(sanitizeForPb(long).length).toBe(60);
  });

  it('preserves digits after the first letter', () => {
    expect(sanitizeForPb('Customer123')).toBe('customer123');
  });

  it('handles unicode by stripping to ascii-safe', () => {
    expect(sanitizeForPb('Café')).toBe('caf');
    expect(sanitizeForPb('Donör Log')).toBe('don_r_log');
  });

  it('handles null/undefined safely', () => {
    expect(sanitizeForPb(null as unknown as string)).toBe('unnamed');
    expect(sanitizeForPb(undefined as unknown as string)).toBe('unnamed');
  });
});

describe('generateAppId', () => {
  it('returns 8-character lowercase hex', () => {
    const id = generateAppId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns different ids on successive calls', () => {
    const a = generateAppId();
    const b = generateAppId();
    const c = generateAppId();
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
