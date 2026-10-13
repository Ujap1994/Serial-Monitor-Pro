import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/i18n';
import { extractValues } from '@shared/core/values';

beforeAll(() => setLanguage('de'));

describe('extractValues', () => {
  it('reads name:value pairs', () => {
    expect(extractValues('Temp:23.5, Druck:1013')).toEqual({ Temp: 23.5, Druck: 1013 });
  });
  it('reads name=value pairs', () => {
    expect(extractValues('Spannung=4.2')).toEqual({ Spannung: 4.2 });
  });
  it('reads plain number series', () => {
    expect(extractValues('1.5;2.5;3.5')).toEqual({ 'Wert 1': 1.5, 'Wert 2': 2.5, 'Wert 3': 3.5 });
  });
  it('supports decimal commas with semicolon separators', () => {
    expect(extractValues('Spannung=4,2;Strom=1,5', 'auto', ';')).toEqual({
      Spannung: 4.2,
      Strom: 1.5,
    });
  });
  it('ignores text and empty lines', () => {
    expect(extractValues('nur text')).toEqual({});
    expect(extractValues('')).toEqual({});
  });
  it('only accepts labelled values in labelled mode', () => {
    expect(extractValues('A:1 B:2', 'labeled', ' ')).toEqual({ A: 1, B: 2 });
    expect(extractValues('1 2 3', 'labeled', ' ')).toEqual({});
  });
  it('does not treat empty fields as zero', () => {
    expect(extractValues('1,,3', 'separated')).toEqual({ 'Wert 1': 1, 'Wert 3': 3 });
  });
  it('accepts exponents and signs', () => {
    expect(extractValues('x:-1.5e3')).toEqual({ x: -1500 });
  });
});
