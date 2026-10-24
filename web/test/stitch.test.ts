import { describe, expect, it } from 'vitest';
import { chronological, planSheets, sheetWidth, SHEET_MAX_AREA, SHEET_MAX_HEIGHT } from '../src/lib/stitch';

describe('copy sheet planner', () => {
  it('plans one image', () => { const sheets = planSheets([{ w: 800, h: 600 }], 800); expect(sheets).toHaveLength(1); expect(sheets[0].indices).toEqual([0]); });
  it('splits seven small images six plus one', () => expect(planSheets(Array.from({ length: 7 }, () => ({ w: 400, h: 300 })), 600).map((sheet) => sheet.indices.length)).toEqual([6, 1]));
  it('scales a tall image uniformly into its own bounded sheet', () => { const sheets = planSheets([{ w: 800, h: 50000 }, { w: 400, h: 300 }], 800); expect(sheets).toHaveLength(2); expect(sheets[0].height).toBeLessThanOrEqual(SHEET_MAX_HEIGHT); expect(sheets[0].placements[0].w).toBeLessThan(752); });
  it('splits by area including padding', () => { const sheets = planSheets(Array.from({ length: 3 }, () => ({ w: 1392, h: 6000 })), 1440); expect(sheets.length).toBe(3); for (const sheet of sheets) expect(sheet.width * sheet.height).toBeLessThanOrEqual(SHEET_MAX_AREA); });
  it('clamps widths and uses default', () => { expect(sheetWidth([200])).toBe(600); expect(sheetWidth([3000])).toBe(1440); expect(sheetWidth([null])).toBe(1170); });
  it('orders chronologically with deterministic ties', () => expect(chronological([{ id: 'c', createdAt: 3 }, { id: 'b', createdAt: 1 }, { id: 'a', createdAt: 1 }]).map((file) => file.id)).toEqual(['a', 'b', 'c']));
});
