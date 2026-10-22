import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createApp } from '../server/app.js';
import { Database } from '../server/database.js';
import type { Candidate, Catalog, SavedPlan, SolveResult } from '../shared/model.js';
import { roadConnectionFixture } from './road-connection-fixture.js';

describe('跨城公路转运方案 API', () => {
  it('无巴黎资源仍生成经布拉格的待落实框架，并可重新校验、保存、读取和导出', async () => {
    const { app } = await createApp({ database: new Database({ file: ':memory:' }), password: '' });
    try {
      const { catalog, request, roadSelection, flightSelection } = roadConnectionFixture();
      const imported = await app.inject({ method: 'POST', url: '/api/catalog/import', payload: catalog });
      expect(imported.statusCode).toBe(200);
      const before = (await app.inject('/api/catalog')).json<Catalog>();
      expect(before.nodes).toHaveLength(2);
      expect(before.nodes.some(node => node.country === 'FR')).toBe(false);
      expect(before.lanes.every(lane => lane.mode === 'air')).toBe(true);

      const solved = await app.inject({ method: 'POST', url: '/api/solve', payload: request });
      expect(solved.statusCode).toBe(200);
      const candidate = solved.json<SolveResult>().candidates.find(item => item.legs.some(leg => leg.laneId === roadSelection));
      expect(candidate).toBeDefined();
      expect(candidate!.legs.some(leg => leg.selectionId === flightSelection)).toBe(true);
      expect(candidate!.complete).toBe(false);
      expect(candidate!.timingComplete).toBe(false);
      expect(candidate!.priceComplete).toBe(false);
      const road = candidate!.legs.at(-1)!;
      expect(road).toMatchObject({
        laneId: roadSelection, mode: 'road', missing: true, timingUnknown: true,
        from: { country: 'CZ', cityId: '3067696' }, to: { country: 'FR', cityId: '2988507' },
      });
      expect(road.price).toBeUndefined();
      expect(candidate!.badges).toEqual([]);
      const laneIds = candidate!.legs.map(leg => leg.selectionId ?? leg.laneId);
      const evaluated = await app.inject({ method: 'POST', url: '/api/evaluate', payload: { request, laneIds } });
      expect(evaluated.statusCode).toBe(200);
      expect(evaluated.json<Candidate>().legs).toEqual(candidate!.legs);

      const savedResponse = await app.inject({ method: 'POST', url: '/api/plans', payload: {
        request, laneIds, title: '虚构测试：成都经布拉格转运巴黎', notes: '',
      } });
      expect(savedResponse.statusCode).toBe(200);
      const saved = savedResponse.json<SavedPlan>();
      expect(saved.candidate.legs).toEqual(candidate!.legs);
      const loaded = await app.inject(`/api/plans/${saved.id}`);
      expect(loaded.statusCode).toBe(200);
      expect(loaded.json<SavedPlan>().candidate).toEqual(saved.candidate);
      expect(loaded.json<SavedPlan>().candidate.legs.at(-1)!.to.cityId).toBe('2988507');

      const html = await app.inject(`/api/plans/${saved.id}/export?format=html&audience=customer`);
      expect(html.statusCode).toBe(200);
      expect(html.body).toContain('公路转运待落实');
      expect(html.body).toContain('送达时间待确认');
      expect(html.body).not.toContain('预计到达：');
      const docx = await app.inject(`/api/plans/${saved.id}/export?format=docx&audience=customer`);
      expect(docx.statusCode).toBe(200);
      const zip = await JSZip.loadAsync(docx.rawPayload);
      const xml = await zip.file('word/document.xml')!.async('string');
      expect(xml).toContain('公路转运待落实');
      expect(xml).toContain('送达时间待确认');
      expect(xml).not.toContain('预计到达：');

      const after = (await app.inject('/api/catalog')).json<Catalog>();
      expect(after.nodes).toEqual(before.nodes);
      expect(after.lanes).toEqual(before.lanes);
    } finally { await app.close(); }
  });
});
